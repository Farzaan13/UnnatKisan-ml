# ml_service/train.py
import os
import joblib
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from sklearn.ensemble import RandomForestRegressor
from sklearn.preprocessing import OrdinalEncoder

# Baseline crop and city catalog matching utils/categories.js and utils/cities.js
CROPS = ["Wheat", "Rice", "Potato", "Tomato", "Onion", "Mustard", "Sugarcane", "Spinach"]
CITIES = ["Kanpur", "Lucknow", "Varanasi", "Agra", "Prayagraj", "Meerut", "Noida", "Gorakhpur"]

BASE_PRICES = {
    "Wheat": 2400, "Rice": 3100, "Potato": 1600, "Tomato": 2800,
    "Onion": 2500, "Mustard": 5400, "Sugarcane": 400, "Spinach": 1500
}

def generate_training_data(n_samples=5000):
    np.random.seed(42)
    rows = []
    start_date = datetime.now() - timedelta(days=365)

    for _ in range(n_samples):
        crop = np.random.choice(CROPS)
        city = np.random.choice(CITIES)
        day_offset = np.random.randint(0, 365)
        date = start_date + timedelta(days=int(day_offset))
        month = date.month
        day_of_week = date.weekday()
        is_festival_season = 1 if month in [3, 10, 11] else 0

        # City population demand multiplier
        city_mult = 1.35 if city in ["Lucknow", "Kanpur", "Noida"] else 1.0
        # Seasonal crop multiplier
        season_mult = 1.3 if (crop in ["Tomato", "Onion", "Potato"] and is_festival_season) else 1.0

        # Target 1: Daily Demand in kg
        base_demand = 850 * city_mult * season_mult
        demand_kg = max(100, base_demand + np.random.normal(0, 120) + (80 if day_of_week >= 4 else 0))

        # Target 2: Mandi Modal Price per Quintal (Rs)
        base_price = BASE_PRICES.get(crop, 2000)
        # Higher demand relative to baseline pushes price up
        demand_pressure = (demand_kg / 850.0)
        modal_price = max(300, base_price * (0.85 + 0.25 * demand_pressure) + np.random.normal(0, base_price * 0.05))

        rows.append({
            "crop": crop,
            "city": city,
            "month": month,
            "day_of_week": day_of_week,
            "is_festival_season": is_festival_season,
            "demand_kg": round(demand_kg, 2),
            "modal_price_quintal": round(modal_price, 2)
        })

    return pd.DataFrame(rows)

def train_and_save():
    print("Generating historical training features...")
    df = generate_training_data()

    encoder = OrdinalEncoder(handle_unknown="use_encoded_value", unknown_value=-1)
    df[["crop_enc", "city_enc"]] = encoder.fit_transform(df[["crop", "city"]])

    features = ["crop_enc", "city_enc", "month", "day_of_week", "is_festival_season"]
    X = df[features]
    y_demand = df["demand_kg"]
    y_price = df["modal_price_quintal"]

    print("Training Random Forest Demand & Mandi Price Regressors...")
    demand_model = RandomForestRegressor(n_estimators=120, max_depth=10, random_state=42)
    price_model = RandomForestRegressor(n_estimators=120, max_depth=10, random_state=42)

    demand_model.fit(X, y_demand)
    price_model.fit(X, y_price)

    joblib.dump(encoder, "encoder.pkl")
    joblib.dump(demand_model, "demand_model.pkl")
    joblib.dump(price_model, "price_model.pkl")
    print("Saved encoder.pkl, demand_model.pkl, and price_model.pkl inside ml_service/!")

if __name__ == "__main__":
    train_and_save()