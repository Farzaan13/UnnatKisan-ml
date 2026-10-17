const CITIES = {
  Kanpur:     { lat: 26.4499, lng: 80.3319 },
  Lucknow:    { lat: 26.8467, lng: 80.9462 },
  Delhi:      { lat: 28.6139, lng: 77.2090 },
  Agra:       { lat: 27.1767, lng: 78.0081 },
  Varanasi:   { lat: 25.3176, lng: 82.9739 },
  Prayagraj:  { lat: 25.4358, lng: 81.8463 },
  Gorakhpur:  { lat: 26.7606, lng: 83.3732 },
  Jhansi:     { lat: 25.4484, lng: 78.5685 },
  Meerut:     { lat: 28.9845, lng: 77.7064 },
  Jaipur:     { lat: 26.9124, lng: 75.7873 },
  Bhopal:     { lat: 23.2599, lng: 77.4126 },
  Indore:     { lat: 22.7196, lng: 75.8577 },
  Patna:      { lat: 25.5941, lng: 85.1376 },
  Chandigarh: { lat: 30.7333, lng: 76.7794 },
  Ahmedabad:  { lat: 23.0225, lng: 72.5714 },
  Mumbai:     { lat: 19.0760, lng: 72.8777 },
  Pune:       { lat: 18.5204, lng: 73.8567 },
  Kolkata:    { lat: 22.5726, lng: 88.3639 },
};

module.exports = { CITIES, CITY_NAMES: Object.keys(CITIES) };