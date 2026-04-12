/*
  SynapticX 6X — BioAmp EXG Pill Reader
  Reads real EMG signal from BioAmp EXG Pill on A1 and streams
  raw ADC values over serial to the laptop for DSP processing.

  Wiring:
    BioAmp EXG Pill:
      VCC  → 5V
      GND  → GND
      OUT  → A1

  Output format: raw 10-bit ADC value (0-1023) per line, ~10kHz sample rate.
  All filtering (HPF, Notch, LPF) happens on the laptop backend — 
  this sketch just reads the analog signal as fast as possible.

  Baud rate: 115200
*/

const int EMG_PIN = A1;

void setup() {
  Serial.begin(115200);
  
  // Faster ADC: set prescaler to 16 (default is 128)
  // This gives ~77kHz ADC clock → ~5.9kHz effective sample rate on single channel
  // For closer to 10kHz, we use prescaler 16
  ADCSRA = (ADCSRA & 0xF8) | 0x04;  // prescaler = 16
  
  pinMode(EMG_PIN, INPUT);
}

void loop() {
  // Read raw 10-bit ADC from A1 (BioAmp OUT)
  int raw = analogRead(EMG_PIN);
  
  // Send as ASCII line — backend parses this
  Serial.println(raw);
  
  // ~100μs delay for ~10kHz sample rate
  // The analogRead + Serial.println takes ~60-80μs with fast ADC,
  // so this small delay brings us close to 10kHz
  delayMicroseconds(30);
}
