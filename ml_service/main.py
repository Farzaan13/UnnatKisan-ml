# ml_service/main.py
import os
import math
import joblib
import pandas as pd
from datetime import datetime, timedelta
from typing import List, Optional
from fastapi import FastAPI
from pydantic import BaseModel
from train import train_and_save

app = FastAPI(title="UnnatKisan ML Microservice")

# Auto-train demand & price models if .pkl files don't exist yet
if not os.path.exists("demand_model.pkl"):
    train_and_save()

encoder = joblib.load("encoder.pkl")
demand_model = joblib.load("demand_model.pkl")
price_model = joblib.load("price_model.pkl")

# Default UP City Coordinates fallback if a record only has a city name
CITY_COORDS = {
    "Kanpur": (26.4499, 80.3319),
    "Lucknow": (26.8467, 80.9462),
    "Varanasi": (25.3176, 82.9739),
    "Agra": (27.1767, 78.0081),
    "Prayagraj": (25.4358, 81.8463),
    "Meerut": (28.9845, 77.7064),
    "Noida": (28.5355, 77.3910),
    "Gorakhpur": (26.7606, 83.3732),
    "Delhi": (28.6139, 77.2090),
}

# Perishability decay factor by category (higher = spoils faster in transit)
PERISHABILITY_WEIGHT = {
    "vegetable": 1.8,
    "fruit": 1.6,
    "other": 1.2,
    "pulse": 0.6,
    "grain": 0.4,
}


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculates road-adjusted distance in km between two GPS coordinates."""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlon / 2) ** 2
    )
    straight_km = R * (2 * math.atan2(math.sqrt(a), math.sqrt(1 - a)))
    return round(straight_km * 1.22, 2)  # 1.22x road winding factor


def compute_spoilage_risk(category: str, distance_km: float, days_since_harvest: int = 1) -> float:
    """ML heuristic/logistic scoring for transit spoilage risk (0% to 95%)."""
    weight = PERISHABILITY_WEIGHT.get((category or "other").lower(), 1.0)
    transit_hours = distance_km / 38.0  # Avg truck speed 38 km/h
    raw_score = weight * (transit_hours * 4.5 + max(0, days_since_harvest) * 6.0)
    return round(min(95.0, max(2.0, raw_score)), 1)


# ==========================================
# 1. DEMAND & MANDI PRICE FORECAST ENDPOINT
# ==========================================
class ForecastRequest(BaseModel):
    crop: str
    city: str
    current_mandi_price: Optional[float] = None
    days: int = 7


@app.post("/predict")
def predict_crop_intelligence(req: ForecastRequest):
    crop_clean = req.crop.strip().title()
    city_clean = req.city.strip().title()
    today = datetime.now()

    daily_forecasts = []
    for i in range(req.days):
        target_date = today + timedelta(days=i)
        month = target_date.month
        day_of_week = target_date.weekday()
        is_festival = 1 if month in [3, 10, 11] else 0

        enc_vals = encoder.transform([[crop_clean, city_clean]])[0]
        X_pred = pd.DataFrame([{
            "crop_enc": enc_vals[0],
            "city_enc": enc_vals[1],
            "month": month,
            "day_of_week": day_of_week,
            "is_festival_season": is_festival
        }])

        pred_demand_kg = float(demand_model.predict(X_pred)[0])
        pred_price_quintal = float(price_model.predict(X_pred)[0])

        if req.current_mandi_price and req.current_mandi_price > 0:
            pred_price_quintal = (0.65 * req.current_mandi_price) + (0.35 * pred_price_quintal)

        pred_price_kg = round(pred_price_quintal / 100.0, 2)

        daily_forecasts.append({
            "date": target_date.strftime("%Y-%m-%d"),
            "dayName": target_date.strftime("%a"),
            "predictedDemandKg": round(pred_demand_kg, 0),
            "predictedMandiPriceQuintal": round(pred_price_quintal, 0),
            "predictedMandiPriceKg": pred_price_kg
        })

    avg_mandi_kg = sum(d["predictedMandiPriceKg"] for d in daily_forecasts) / len(daily_forecasts)
    total_7d_demand = sum(d["predictedDemandKg"] for d in daily_forecasts)
    recommended_farmer_price_kg = round(avg_mandi_kg * 1.08, 2)
    price_trend = "UP" if daily_forecasts[-1]["predictedMandiPriceKg"] >= daily_forecasts[0]["predictedMandiPriceKg"] else "STABLE"

    return {
        "crop": crop_clean,
        "city": city_clean,
        "total7DayDemandKg": round(total_7d_demand, 0),
        "avgMandiPriceKg": round(avg_mandi_kg, 2),
        "recommendedPriceKg": recommended_farmer_price_kg,
        "recommendedMinKg": round(avg_mandi_kg * 1.03, 2),
        "recommendedMaxKg": round(avg_mandi_kg * 1.14, 2),
        "trend": price_trend,
        "advice": (
            f"Demand for {crop_clean} in {city_clean} is projected at {int(total_7d_demand)} kg over the next 7 days. "
            f"Listing at ₹{recommended_farmer_price_kg}/kg gives you ~8% more than local Mandi wholesale while saving buyers ~15% off retail."
        ),
        "dailyForecasts": daily_forecasts
    }


# =========================================================
# 2. BUYER SIDE: CLOSEST FARMER & VIRTUAL FPO POOLING MODEL
# =========================================================
class FarmerListing(BaseModel):
    cropId: str
    cropName: str
    category: str = "vegetable"
    kisanName: str = "Kisan"
    location: str = "Kanpur"
    lat: Optional[float] = None
    lng: Optional[float] = None
    price: float
    bulkPrice: Optional[float] = None
    quantity: float
    daysSinceHarvest: int = 1


class ClosestFarmersRequest(BaseModel):
    buyerLat: float
    buyerLng: float
    cropFilter: Optional[str] = None
    requiredQtyKg: Optional[float] = None
    isBulkBuyer: bool = False
    listings: List[FarmerListing]


@app.post("/find-closest-farmers")
def find_closest_farmers(req: ClosestFarmersRequest):
    ranked = []

    for item in req.listings:
        if req.cropFilter and req.cropFilter.strip().lower() not in item.cropName.lower():
            continue

        f_lat, f_lng = item.lat, item.lng
        if not f_lat or not f_lng:
            matched_city = next((c for c in CITY_COORDS if c.lower() in item.location.lower()), "Kanpur")
            f_lat, f_lng = CITY_COORDS[matched_city]

        dist_km = haversine_km(req.buyerLat, req.buyerLng, f_lat, f_lng)
        eta_mins = max(15, int(round((dist_km / 38.0) * 60)))
        spoilage_risk = compute_spoilage_risk(item.category, dist_km, item.daysSinceHarvest)
        freshness_score = round(100.0 - spoilage_risk, 1)

        transport_per_kg = round(min(12.0, dist_km * 0.035), 2)
        unit_price = (item.bulkPrice if (req.isBulkBuyer and item.bulkPrice) else item.price)
        landed_cost_kg = round(unit_price + transport_per_kg, 2)

        ai_rank_cost = (dist_km * 0.55) + (landed_cost_kg * 1.2) + (spoilage_risk * 0.4)

        ranked.append({
            "cropId": item.cropId,
            "cropName": item.cropName,
            "category": item.category,
            "kisanName": item.kisanName,
            "location": item.location,
            "lat": f_lat,
            "lng": f_lng,
            "distanceKm": dist_km,
            "etaMins": eta_mins,
            "basePriceKg": unit_price,
            "transportCostKg": transport_per_kg,
            "landedCostKg": landed_cost_kg,
            "availableQtyKg": item.quantity,
            "spoilageRiskPct": spoilage_risk,
            "freshnessScore": freshness_score,
            "aiRankCost": round(ai_rank_cost, 2)
        })

    ranked.sort(key=lambda x: (x["distanceKm"], x["aiRankCost"]))

    if ranked:
        ranked[0]["badge"] = "📍 Closest Farmer"
        best_val = min(ranked, key=lambda x: x["landedCostKg"])
        if best_val["cropId"] != ranked[0]["cropId"]:
            best_val["badge"] = "💰 Best Landed Price"
        else:
            ranked[0]["badge"] = "🏆 Closest & Best Value"

    fpo_pool = []
    remaining_qty = req.requiredQtyKg or 0
    if remaining_qty > 0 and ranked:
        for farmer in ranked:
            if remaining_qty <= 0:
                break
            take_qty = min(farmer["availableQtyKg"], remaining_qty)
            if take_qty > 0:
                fpo_pool.append({
                    "cropId": farmer["cropId"],
                    "kisanName": farmer["kisanName"],
                    "cropName": farmer["cropName"],
                    "location": farmer["location"],
                    "distanceKm": farmer["distanceKm"],
                    "takeQtyKg": take_qty,
                    "landedCostKg": farmer["landedCostKg"],
                    "subtotalRs": round(take_qty * farmer["landedCostKg"], 2),
                    "lat": farmer["lat"],
                    "lng": farmer["lng"]
                })
                remaining_qty -= take_qty

    return {
        "totalMatches": len(ranked),
        "closestFarmer": ranked[0] if ranked else None,
        "farmers": ranked,
        "fpoPool": {
            "requestedQtyKg": req.requiredQtyKg,
            "fulfilledQtyKg": round((req.requiredQtyKg or 0) - max(0, remaining_qty), 2),
            "farmersCount": len(fpo_pool),
            "allocations": fpo_pool
        } if req.requiredQtyKg else None
    }


# ================================================================
# 3. KISAN / LOGISTICS SIDE: PERISHABILITY-AWARE ROUTE OPTIMIZER
# ================================================================
class DeliveryStop(BaseModel):
    orderId: str
    buyerName: str
    cropName: str
    category: str = "vegetable"
    quantityKg: float
    city: str
    lat: Optional[float] = None
    lng: Optional[float] = None


class RouteOptimizeRequest(BaseModel):
    pickupCity: str = "Kanpur"
    pickupLat: Optional[float] = None
    pickupLng: Optional[float] = None
    stops: List[DeliveryStop]


@app.post("/optimize-route")
def optimize_delivery_route(req: RouteOptimizeRequest):
    start_lat, start_lng = req.pickupLat, req.pickupLng
    if not start_lat or not start_lng:
        start_lat, start_lng = CITY_COORDS.get(req.pickupCity.title(), CITY_COORDS["Kanpur"])

    if not req.stops:
        return {
            "pickupCity": req.pickupCity,
            "pickupCoords": [start_lat, start_lng],
            "totalKm": 0,
            "naiveKm": 0,
            "kmSaved": 0,
            "fuelSavedLiters": 0,
            "estimatedCostRs": 0,
            "orderedStops": []
        }

    nodes = []
    for s in req.stops:
        s_lat, s_lng = s.lat, s.lng
        if not s_lat or not s_lng:
            matched = next((c for c in CITY_COORDS if c.lower() in s.city.lower()), "Kanpur")
            s_lat, s_lng = CITY_COORDS[matched]
        p_weight = PERISHABILITY_WEIGHT.get((s.category or "vegetable").lower(), 1.2)
        nodes.append({
            "orderId": s.orderId,
            "buyerName": s.buyerName,
            "cropName": s.cropName,
            "category": s.category,
            "quantityKg": s.quantityKg,
            "city": s.city,
            "lat": s_lat,
            "lng": s_lng,
            "perishabilityWeight": p_weight
        })

    naive_km = 0.0
    curr_lat, curr_lng = start_lat, start_lng
    for n in nodes:
        naive_km += haversine_km(curr_lat, curr_lng, n["lat"], n["lng"])
        curr_lat, curr_lng = n["lat"], n["lng"]

    unvisited = nodes.copy()
    ordered = []
    curr_lat, curr_lng = start_lat, start_lng
    total_km = 0.0
    cumulative_mins = 0

    while unvisited:
        best_idx = 0
        best_score = float("inf")
        for idx, candidate in enumerate(unvisited):
            d = haversine_km(curr_lat, curr_lng, candidate["lat"], candidate["lng"])
            priority_factor = 1.0 - min(0.30, (candidate["perishabilityWeight"] - 0.4) * 0.18)
            score = d * priority_factor
            if score < best_score:
                best_score = score
                best_idx = idx

        chosen = unvisited.pop(best_idx)
        leg_km = haversine_km(curr_lat, curr_lng, chosen["lat"], chosen["lng"])
        total_km += leg_km
        leg_mins = max(10, int(round((leg_km / 38.0) * 60)))
        cumulative_mins += leg_mins
        spoilage_risk = compute_spoilage_risk(chosen["category"], total_km, 1)

        chosen_out = {
            **chosen,
            "stopNumber": len(ordered) + 1,
            "legKm": round(leg_km, 2),
            "cumulativeKm": round(total_km, 2),
            "etaMins": cumulative_mins,
            "spoilageRiskPct": spoilage_risk,
            "priorityBadge": "🔥 High Perishability Priority" if chosen["perishabilityWeight"] >= 1.5 else "📦 Standard Load"
        }
        ordered.append(chosen_out)
        curr_lat, curr_lng = chosen["lat"], chosen["lng"]

    km_saved = round(max(0.0, naive_km - total_km), 2)
    fuel_saved = round(km_saved / 12.0, 2)

    return {
        "pickupCity": req.pickupCity,
        "pickupCoords": [start_lat, start_lng],
        "totalKm": round(total_km, 2),
        "naiveKm": round(naive_km, 2),
        "kmSaved": km_saved,
        "fuelSavedLiters": fuel_saved,
        "estimatedCostRs": round(total_km * 14.0),
        "orderedStops": ordered
    }