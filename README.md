# Concrete Maturity Meter — dashboard

A dependency-free monitoring dashboard (plain HTML, CSS and JavaScript). No build step, no `npm install`.

## Run on Windows

No npm, Node.js or installation is needed. Use a current Chrome, Edge or Firefox.

1. Right-click `concrete-maturity-meter.zip` → **Extract All…** (do not run it from inside the ZIP preview).
2. Open the extracted `concrete-maturity-meter` folder.
3. Double-click **`index.html`**. The dashboard opens in your default browser.
4. Click **Start Simulation**.

Everything works this way, including the simulation, charts, settings, CSV export and the ESP32 connection. A local server is **not required**.

### Optional: run through a local server

Only needed if your browser blocks something when opening the file directly, or if you prefer `http://localhost`. This requires Python, which is not needed for the normal method.

1. Open the extracted folder in File Explorer, click the address bar, type `cmd` and press Enter.
2. Run:

```bat
py -m http.server 8080
```

3. Open http://localhost:8080 in your browser. Press `Ctrl+C` in the window to stop it.

### Troubleshooting

- **Settings not remembered:** some browsers disable storage for local files. The dashboard still works; use the localhost method above to keep settings.
- **ESP32 shows Offline:** check the IP address in Settings, that the laptop and ESP32 are on the same Wi-Fi, and that the page was opened with `file://` or `http://` (not `https://`).
- **Windows SmartScreen / "Mark of the Web":** if files appear blocked after extracting, right-click the ZIP → Properties → tick **Unblock** → OK, then extract again.

## Other platforms

```bash
cd concrete-maturity-meter
python3 -m http.server 8080
# open http://localhost:8080
```

## What it does

- Simulated curing temperature (clearly labelled SIMULATED) with Start / Stop and 60× / 600× / 3600× speed.
- Nurse-Saul maturity: `M = Σ (Ta − T0) · Δt`, trapezoid rule, using **elapsed (simulated) time**. Datum T0 is adjustable (default −10 °C) and changing it recomputes all history.
- Equivalent age at a reference temperature (default 20 °C): `te = M / (Tr − T0)`.
- Strength shows **"Calibration required"** until you enter coefficients `a` and `b` in Settings (`S = a + b·ln(M)`). "Use demo values" is available for previews and is labelled "not validated".
- Temperature chart, maturity chart, summary stats, recent-readings table, CSV export.

## Connecting the ESP32 later

All data enters through one function in `app.js`: `addSample(temp, t, wall, source)`.
The simulator and the HTTP source both call it, so nothing else changes when real hardware is used.

In **Settings → Data source** choose **ESP32 over HTTP**, enter the endpoint (e.g. `http://192.168.1.50/api/latest`) and a poll interval. The endpoint must return:

```json
{ "temperature_c": 24.56 }
```

A DS18B20 fault value (−127 °C) is rejected and shown as a sensor fault.

### ESP32 sketch (Arduino core, DS18B20 on GPIO 4 with a 4.7 kΩ pull-up)

```cpp
#include <WiFi.h>
#include <WebServer.h>
#include <OneWire.h>
#include <DallasTemperature.h>

const char* WIFI_SSID = "YOUR_WIFI";
const char* WIFI_PASS = "YOUR_PASSWORD";

OneWire oneWire(4);
DallasTemperature sensors(&oneWire);
WebServer server(80);

void handleLatest() {
  sensors.requestTemperatures();
  float t = sensors.getTempCByIndex(0);
  server.sendHeader("Access-Control-Allow-Origin", "*");   // lets the dashboard read it
  server.sendHeader("Cache-Control", "no-store");
  if (t == DEVICE_DISCONNECTED_C) {
    server.send(503, "application/json", "{\"error\":\"sensor_disconnected\"}");
    return;
  }
  server.send(200, "application/json", String("{\"temperature_c\":") + String(t, 2) + "}");
}

void setup() {
  Serial.begin(115200);
  sensors.begin();
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) delay(300);
  Serial.println(WiFi.localIP());
  server.on("/api/latest", handleLatest);
  server.begin();
}

void loop() { server.handleClient(); }
```

Notes:

- Open the dashboard from `file://` or `http://` (not `https://`), otherwise the browser blocks requests to the plain-HTTP ESP32.
- Your phone/laptop and the ESP32 must be on the same network.

### Better long-term setup with your FastAPI backend

Polling the ESP32 directly means history is lost when the page closes. Preferred design:
ESP32 `POST`s readings to FastAPI → stored in SQLite → the dashboard polls FastAPI.
Point the endpoint at your backend; it only needs to return the same JSON:

```python
@app.get("/api/latest")
def latest(db: Session = Depends(get_db)):
    row = db.query(Reading).order_by(Reading.id.desc()).first()
    return {"temperature_c": row.temperature_c}
```

(Add `CORSMiddleware` if the dashboard is served from a different origin.)

## Files

- `index.html` — layout
- `styles.css` — design system and responsive rules
- `app.js` — settings, maturity maths, data sources, charts, rendering
