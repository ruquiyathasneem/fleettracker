/*
 * Vehicle Tracking System - Arduino UNO + SIM808 GPS/GPRS Shield Sketch
 * 
 * This sketch interfaces the Arduino UNO with a SIM808 module.
 * It reads GPS coordinates (latitude, longitude, speed, heading) 
 * and transmits them to the server via GPRS using HTTP POST requests.
 * 
 * Hardware Connections:
 * - Arduino UNO Pin 7 (RX) -> SIM808 TX
 * - Arduino UNO Pin 8 (TX) -> SIM808 RX
 * - Common GND
 * - SIM808 powered by external 5V/2A power supply (USB power is insufficient)
 */

#include <SoftwareSerial.h>

// Define SoftwareSerial pins for SIM808 communication
SoftwareSerial sim808(7, 8); // RX, TX

// Configuration parameters
const char* APN = "your_telecom_apn";              // e.g. "airtelgprs.com" or "internet"
const char* SERVER_URL = "http://your-server-ip:8000/api/location";
const char* DEVICE_TOKEN = "tracker-device-123";

// Buffer variables for parsing GPS
char gps_buffer[100];
float latitude = 0.0;
float longitude = 0.0;
float speed_kmph = 0.0;
float heading = 0.0;

void setup() {
  // Start hardware serial for debugging output
  Serial.begin(9600);
  while (!Serial);
  Serial.println("Initializing Vehicle Tracker Serial...");

  // Start software serial communication with SIM808
  sim808.begin(9600);
  delay(1000);

  // Initialize the SIM808 Shield
  initSIM808();
}

void loop() {
  Serial.println("\n--- Querying GPS Coordinates ---");
  if (getGPSData()) {
    Serial.print("GPS Success! Lat: "); Serial.print(latitude, 6);
    Serial.print(" | Lng: "); Serial.print(longitude, 6);
    Serial.print(" | Speed: "); Serial.print(speed_kmph, 1);
    Serial.print(" km/h | Heading: "); Serial.println(heading, 1);

    // Send the telemetry to the central API server via GPRS
    postLocationData(latitude, longitude, speed_kmph, heading);
  } else {
    Serial.println("GPS Fix not active yet. Retrying...");
  }
  
  // Wait 10 seconds before next GPS update
  delay(10000);
}

// Sends an AT command to SIM808 and waits for response or timeout
String sendATCommand(String command, int timeout) {
  String response = "";
  sim808.println(command);
  long int time = millis();
  while ((time + timeout) > millis()) {
    while (sim808.available()) {
      char c = sim808.read();
      response += c;
    }
  }
  return response;
}

// Initial configuration for SIM808 GSM, GPRS and GPS
void initSIM808() {
  Serial.println("Setting up SIM808 module...");
  
  // Check communication
  sendATCommand("AT", 1000);
  
  // Set SMS to Text Mode (needed for SMS location request feature)
  sendATCommand("AT+CMGF=1", 1000);
  
  // Turn on GPS power
  sendATCommand("AT+CGPSPWR=1", 2000);
  
  // Set GPS to stand-alone mode
  sendATCommand("AT+CGPSTST=1", 1000);
  
  // Attach from GPRS service
  sendATCommand("AT+CGATT=1", 2000);
  
  // Configure GPRS connection
  sendATCommand("AT+SAPBR=3,1,\"CONTYPE\",\"GPRS\"", 1000);
  sendATCommand("AT+SAPBR=3,1,\"APN\",\"" + String(APN) + "\"", 1000);
  
  // Open GPRS Context
  sendATCommand("AT+SAPBR=1,1", 3000);
  
  // Query IP address to ensure connection is active
  String ip_resp = sendATCommand("AT+SAPBR=2,1", 2000);
  Serial.print("GPRS IP: ");
  Serial.println(ip_resp);
  
  Serial.println("SIM808 Initialization Complete.");
}

// Fetch and parse current coordinates from SIM808 GPS
bool getGPSData() {
  // Query GPS info: AT+CGPSINF=2 (Recommended for SIM808)
  String resp = sendATCommand("AT+CGPSINF=2", 2000);
  
  // Expected response: +CGPSINF: 2,1,20260628043512.000,12.971600,77.594600,10.50,15.2,45.3...
  // Format: mode,gps_fix,time,lat,lng,altitude,speed_kmph,course...
  int index = resp.indexOf("+CGPSINF:");
  if (index == -1) return false;
  
  String data = resp.substring(index);
  
  // Parse comma-separated fields
  int commaIndex[10];
  int count = 0;
  for (int i = 0; i < data.length(); i++) {
    if (data.charAt(i) == ',') {
      commaIndex[count] = i;
      count++;
      if (count >= 10) break;
    }
  }
  
  if (count < 8) return false;
  
  // Field 1: Fix status (1 = 2D/3D fix, 0 = invalid)
  int fix_status = data.substring(commaIndex[0] + 1, commaIndex[1]).toInt();
  if (fix_status == 0) return false;
  
  // Field 3: Latitude
  latitude = data.substring(commaIndex[2] + 1, commaIndex[3]).toFloat();
  // Field 4: Longitude
  longitude = data.substring(commaIndex[3] + 1, commaIndex[4]).toFloat();
  // Field 6: Speed (knots) - Convert to km/h by multiplying by 1.852
  float speed_knots = data.substring(commaIndex[5] + 1, commaIndex[6]).toFloat();
  speed_kmph = speed_knots * 1.852;
  // Field 7: Course (heading in degrees)
  heading = data.substring(commaIndex[6] + 1, commaIndex[7]).toFloat();
  
  return true;
}

// Transmit location data using AT HTTP Commands
void postLocationData(float lat, float lng, float speed, float head) {
  Serial.println("Initiating HTTP POST...");
  
  // Initialize HTTP service
  sendATCommand("AT+HTTPINIT", 1000);
  
  // Set HTTP CID
  sendATCommand("AT+HTTPPARA=\"CID\",1", 1000);
  
  // Set HTTP URL
  sendATCommand("AT+HTTPPARA=\"URL\",\"" + String(SERVER_URL) + "\"", 1000);
  
  // Set Content Type to JSON
  sendATCommand("AT+HTTPPARA=\"CONTENT\",\"application/json\"", 1000);
  
  // Construct JSON Body
  // Example: {"device_token":"tracker-device-123","latitude":12.9716,"longitude":77.5946,"speed_kmph":15.5,"heading":45.0}
  String body = "{\"device_token\":\"" + String(DEVICE_TOKEN) + "\",";
  body += "\"latitude\":" + String(lat, 6) + ",";
  body += "\"longitude\":" + String(lng, 6) + ",";
  body += "\"speed_kmph\":" + String(speed, 1) + ",";
  body += "\"heading\":" + String(head, 1) + "}";
  
  // Set HTTP Data size and input timeout
  sendATCommand("AT+HTTPDATA=" + String(body.length()) + ",5000", 1000);
  
  // Write body content
  sim808.print(body);
  delay(1000);
  
  // Execute POST Request
  String action_resp = sendATCommand("AT+HTTPACTION=1", 4000);
  Serial.print("HTTP Action Response: ");
  Serial.println(action_resp);
  
  // Read Server Response (Optional debug)
  String read_resp = sendATCommand("AT+HTTPREAD", 2000);
  Serial.print("Server Return: ");
  Serial.println(read_resp);
  
  // Terminate HTTP service
  sendATCommand("AT+HTTPTERM", 1000);
}
