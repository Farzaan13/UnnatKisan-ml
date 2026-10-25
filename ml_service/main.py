# ml_service/main.py
import os
import joblib
import pandas as pd
from datetime import datetime, timedelta
from fastapi import FastAPI
from pydantic import BaseModel
from train import train_and_save

app = FastAPI(title="UnnatKisan ML Microservice")

# Auto-train on first launch if .pkl files don't exist yet
if not os.path.exists("demand_model.pkl"):
    train_and_save()

encoder = joblib.load("encoder.pkl")
demand_model = joblib.load("demand_model.pkl")
price_model = joblib.load("price_model.pkl")

class ForecastRequest(BaseModel):
    crop: str
    city: str
    current_mandi_price: float | None = None  # Optional live price from models/MandiPrice.js
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

        # Blend with live MandiPrice.js modal price if provided
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

    # Direct-to-buyer sweet spot: +8% above wholesale Mandi for farmer, ~15% below retail for buyer
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