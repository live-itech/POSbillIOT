#include <SPI.h>
#include <UIPEthernet.h>
#include <AESLib.h>
#include <EEPROM.h>

// too handle millis
#define ULONG_MAX 4294967295UL

// Network timeout
const unsigned long connTimeout = 1000;

const int PIN_RESET = 1;

// PIN OFFSET
const int OFFSET = 1;

const int EEPROM_MAC_ADDRESS = 0; // 6 byte
const int EEPROM_IP_ADDR_ADDRESS = 6; // 4 byte
const int EEPROM_CIDR_ADDRESS = 10; // 1 byte
const int EEPROM_GATEWAY_ADDRESS = 11; // 4 byte
const int EEPROM_AESKEY_ADDRESS = 15; // 16 byte
const int EEPROM_PIN_STATE = 32; // 1 byte
const int EEPROM_BLINK_DELAY = 33; // 2 byte
const int EEPROM_LOOP_DELAY = 35; // 1 byte

typedef struct {
  int blinkCount;
  unsigned long lastRun;
  int afterBlink;
} BlinkIO;

// Use 2 to 49 , diregard index 0 and 1
BlinkIO blinkIO[50];
int blinkDelay = 1000;
int loopDelay = 0;

AESLib aesLib;
IPAddress ip, gateway, netmask;
EthernetServer *server;

bool STATE_ON = HIGH;
bool STATE_OFF = !STATE_ON;

byte mac[6];
// aeskey global var, do not set the value here
byte aesKey[16] = {0};
byte rawMessage[32] = {0};
byte response[34] = {0};
byte CRLF[2] = { 0x0D, 0x0A };

// default mac if error
byte defaultMac[6] = { 0x02, 0xAB, 0xBC, 0xCD, 0xDE, 0xEF };
// default aeskey if error
byte defaultAesKey[16] = { 0x68, 0x66, 0x69, 0x6f, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x61, 0x62, 0x63, 0x64, 0x65, 0x66 };
IPAddress defaultIP = IPAddress(192, 168, 137, 254);
IPAddress defaultGateway = IPAddress(192, 168, 137, 1);

// For buffering config byte before writing to eeprom
byte bufferConfig[32] = {0};


// Factory reset button
bool buttonPressed = false;
bool factoryReset = false;
unsigned long pressStartTime;

void setup() {
  Serial.begin(9600);
  while (!Serial);
  randomSeed(analogRead(0));

  loadEEPROM();
  
  pinMode(PIN_RESET , INPUT_PULLUP);
  for (int i = 1; i <= 52; i++) {
    pinMode(i + OFFSET, OUTPUT);
    digitalWrite(i + OFFSET, STATE_OFF);
  }

  startServer();
}

void loop() {
  if (digitalRead(PIN_RESET) == 0) {
    if (!buttonPressed) {
      buttonPressed = true;
      pressStartTime = millis();
      return;
    } else if (millis() - pressStartTime >= 5000) {
      factoryReset = true;
      return;
    } else {
      delay(100);
      return;
    }
  }

  // Button release
  if (buttonPressed) {
    buttonPressed = false;
    if (factoryReset) {
      Serial.println("Factory Reset");
      factoryReset = false;
      processType7F(0);
    } else {
      Serial.println("Normal Reset");
    }
    asm volatile ("jmp 0");
    
  }

  buttonPressed = false;

  if (Serial.available()) {
    memset(rawMessage, 0, sizeof(rawMessage));
    memset(response, 0, sizeof(response));

    int bytesRead = Serial.readBytes(rawMessage, 32);
    processMessage(rawMessage);
    memcpy(response + 32, &CRLF, 2);
    Serial.write(response, 34);
    delay(100);
    Serial.flush();
  } else if (Ethernet.linkStatus() == LinkON) {
    EthernetClient client = server->available();
    if (client) {
      unsigned long start = millis();

      while (client.connected()) {
        if (client.available() >= 32) {
          memset(rawMessage, 0, sizeof(rawMessage));
          memset(response, 0, sizeof(response));

          client.read(rawMessage, 32);
          processMessage(rawMessage);
          memcpy(response + 32, &CRLF, 2);
          client.write(response, 34);
          break;
        }

        if ((unsigned long)(millis() - start) >= connTimeout) {
          break;
        }
      }
      client.stop();
    }
  }

  blink();
  delay(loopDelay);
}

void startServer() {
  int retryCount = 3;

  for (int i = 1; i < retryCount; i++) {
    Ethernet.begin(mac, ip, gateway, gateway, netmask);

    if (Ethernet.localIP() != IPAddress(0, 0, 0, 0)) {
      break;
    }
    // retry delay
    delay(1000);
  }
  delay(100);

  server = new EthernetServer(12321);
  server->begin();
}


/**

   When error or success do not encrypt message

   Error Code
   0xFF - Undefined Error
   0xFE - Reset Ethernet
   0xFD - Incorrect Message Length
   0xFC - Restart arduino ( Factory reset )
   0xFB - Aes key updated
   0xFA - No Response to client
   0xF9 - Incorrect Encryption Key

   Success
   0x00 - Success
*/
void processMessage(byte * rawMessage) {
  bool messageV1 = false;
  byte decryptedMessage[8] = {0};

  int messageLength = decrypt(rawMessage, decryptedMessage);

  // v1 Backward compatible, move last 3 byte to end of array
  if (messageLength == 4) {
    messageV1 = true;
    for (int i = 0; i < 3; i++) {
      decryptedMessage[5 + i] = decryptedMessage[i + 1];
      decryptedMessage[i + 1] = 0;
    }
  } else if (messageLength <= 0) {
    response[0] = 0xF9;
    return;
  } else if (messageLength != 8) {
    // Incorrect message length return non zero
    response[0] = 0xFD;
    return;
  }

  uint64_t intValue = byteArrayToInt(decryptedMessage);
  int type = intValue >> 60;

  if (type == 0) {
    // Tipe 0: IO Status
    uint64_t result = processType0(intValue);
    byte messageBytes[8] = {0};
    if (messageV1 == true) {
      // v1 backward compatibility, first byte + last three byte
      uint32_t resultV1 = ((result >> 56) << 24) + (result & 0xFFFFFF);
      uint32ToBytes(resultV1, messageBytes);
      encrypt(messageBytes, 4, response);
    } else {
      uint64ToBytes(result, messageBytes);
      encrypt(messageBytes, 8, response);
    }
    if (messageBytes[0] > 0x02) {
      response[0] = 0xFF;
    }  
    return;
  } else if (type == 1) {
    // Tipe 1: Ubah IO Bersamaan
    processType1(intValue);
  } else if (type == 2) {
    // Tipe 2: Ubah satu IO tanpa mengubah yang lain
    processType2(intValue);
  } else if (type == 3) {
    // Tipe 3: Blink Multiple IO
    processType3(intValue);
  } else if (type == 4) {
    // Tipe 4: Blink Single IO
    processType4(intValue);
  } else if (type == 7) {
    if (messageV1 == true) {
      response[0] = 0xFF;
      return;
    }
    int subType = (intValue >> 56) & 0xF;
    if (subType == 0) {
      uint64_t result = processType70(intValue);
      byte messageBytes[8] = {0};
      uint64ToBytes(result, messageBytes);
      encrypt(messageBytes, 8, response);
      return;
    } else if (subType == 1) {
      response[0] = processType71(intValue);
    } else if (subType == 2) {
      response[0] = processType72(intValue);
    } else if (subType == 3) {
      response[0] = processType73(intValue);
    } else if (subType == 7) {
      response[0] = processType77(intValue);
    } else if (subType == 8) {
      response[0] = processType78(intValue);
    } else if (subType == 9) {
      response[0] = processType79(intValue);
    } else if (subType == 0xF) {
      response[0] = processType7F(intValue);
    } else {
      response[0] = 0xFF;
    }
  } else {
    response[0] = 0xFF;
  }
}

// Function to convert a 8-byte array to an int (big-endian)
uint64_t byteArrayToInt(byte byteVal[8]) {
  uint64_t value = 0;
  value = ((uint64_t)byteVal[0] << 56) |
          ((uint64_t)byteVal[1] << 48) |
          ((uint64_t)byteVal[2] << 40) |
          ((uint64_t)byteVal[3] << 32) |
          ((uint64_t)byteVal[4] << 24) |
          ((uint64_t)byteVal[5] << 16) |
          ((uint64_t)byteVal[6] << 8) |
          ((uint64_t)byteVal[7]);
  return value;
}


// Big endian
void uint64ToBytes(uint64_t value, byte * bytes) {
  bytes[0] = (byte)(value >> 56);
  bytes[1] = (byte)(value >> 48);
  bytes[2] = (byte)(value >> 40);
  bytes[3] = (byte)(value >> 32);
  bytes[4] = (byte)(value >> 24);
  bytes[5] = (byte)(value >> 16);
  bytes[6] = (byte)(value >> 8);
  bytes[7] = (byte)value;
}

// Big endian, for v1 backward compatible
void uint32ToBytes(uint32_t value, byte * bytes) {
  bytes[0] = (byte)(value >> 24);
  bytes[1] = (byte)(value >> 16);
  bytes[2] = (byte)(value >> 8);
  bytes[3] = (byte)value;
}

void printByteArray(byte * arr, int length) {
  for (int i = 0; i < length; i++) {
    if (arr[i] < 0x10) {
      Serial.print("0");
    }
    Serial.print(arr[i], HEX);
    Serial.print(" ");
  }
  Serial.println();
}

void generateRandomIV(byte * iv, int length) {
  for (int i = 0; i < length; i++) {
    iv[i] = random(0, 256);
  }
}

int decrypt(byte * message, byte * outputBuffer) {
  byte decIV[16] = {0};
  byte encryptedMessage[16] = {0};
  byte paddedMessage[16] = {0};
  uint16_t outputLength = 0;

  memcpy(decIV, message, 16);
  memcpy(encryptedMessage, message + 16, 16);

  // Dekripsi pesan
  outputLength = aesLib.decrypt(encryptedMessage, sizeof(encryptedMessage), paddedMessage, aesKey, 128, decIV);
  int messageLength = 16 - paddedMessage[outputLength - 1];

  if (messageLength < 0) {
    return messageLength;
  }

  // Message size always first 8 byte, the rest is padding
  memcpy(outputBuffer, paddedMessage, messageLength);
  return messageLength;
}

int encrypt(byte * messageBytes, int messageLength, byte * outputBuffer) {
  // Determine the length with PKCS7 padding
  int blockSize = 16;
  int paddedLength = ((messageLength / blockSize) + 1) * blockSize;
  byte paddedMessage[paddedLength];

  // Copy message and apply PKCS7 padding
  memcpy(paddedMessage, messageBytes, messageLength);
  byte paddingValue = paddedLength - messageLength;
  for (int i = messageLength; i < paddedLength; i++) {
    paddedMessage[i] = paddingValue;
  }

  byte encIV[16] = {0};
  byte encryptedMessage[16] = {0};

  generateRandomIV(encIV, 16);
  // IV changed after use by encrypt, copy it here first
  memcpy(outputBuffer, encIV, 16);

  aesLib.encrypt(paddedMessage, paddedLength, encryptedMessage, aesKey, 128, encIV);
  memcpy(outputBuffer + 16, encryptedMessage, 16);

  // Set output length
  int outputLength = 16 + paddedLength;
  return outputLength;
}

uint64_t processType0(uint64_t intValue) {
  int group = (intValue >> 56) & 0xF;
  uint64_t data = ((uint64_t)group << 56);

  if (group > 2) {
    data = ((uint64_t) 0xFF << 56);
    return data;
  }

  // Periksa status masing-masing pin
  int pinStart = 1 + OFFSET + ((group  - 1) * 24);
  int pinEnd = pinStart + 23;
  for (int i = pinStart; i <= pinEnd; i++) {
    // Periksa apakah bit ke-i adalah high (1) atau low (0)
    if (digitalRead(i) == STATE_ON) {
      uint64_t val = ((uint64_t)1 << ((group * 24) - i + OFFSET));
      data += val;
    }
  }
  return data;
}

void processType1(uint64_t intValue) {
  // Dapatkan grup
  int group = (intValue >> 56) & 0xF;
  for (int i = 1; i < 25; i++) {
    int io_position = OFFSET + i + ( (group - 1 ) * 24 );
    bool state = (intValue >> (24 - i)) & 0x1;
    if (state == 1) {
      // turn on io_position
      digitalWrite(io_position, STATE_ON);
    } else {
      // turn off io_position
      digitalWrite(io_position, STATE_OFF);
    }
  }
}

void processType2(uint64_t intValue) {
  // Dapatkan grup
  int state = (intValue >> 56) & 0xF;
  int io_position = OFFSET + ( intValue & 0xFF );

  if (state == 1) {
    digitalWrite(io_position, STATE_ON);

  } else  {
    digitalWrite(io_position, STATE_OFF);
  }
}

void processType3(uint64_t intValue) {
  // Dapatkan grup
  int group = (intValue >> 56) & 0xF;

  for (int i = 8; i < 32; i++) {
    int io_position = OFFSET + i - 7 + ((group - 1) * 24);
    int state = bitRead(intValue, 31 - i);

    if (state == 0) {
      continue;
    }

    digitalWrite(io_position, STATE_OFF);
    blinkIO[io_position].blinkCount = 6;
    blinkIO[io_position].lastRun = millis();
    blinkIO[io_position].afterBlink = STATE_ON;
  }
}

void processType4(uint64_t intValue) {
  int state = (intValue >> 56) & 0xF;
  int blinkCount = (intValue >> 20) & 0xF;
  int io_position = OFFSET + (intValue & 0xFF);

  if (blinkCount == 0 || blinkCount > 5) {
    blinkCount = 3;
  }

  digitalWrite(io_position, STATE_OFF);

  blinkIO[io_position].blinkCount = blinkCount * 2;
  blinkIO[io_position].lastRun = millis();

  if (state == 1) {
    blinkIO[io_position].afterBlink = STATE_ON;
  }
  else {
    blinkIO[io_position].afterBlink = STATE_OFF;
  }
}

uint64_t processType70(uint64_t intValue) {
  byte test[8] = {0};
  int type = (intValue >> 60) & 0xF;
  uint64_t data = ((uint64_t)type << 60);

  int configType = (intValue >> 52) & 0xF;

  if (configType == 1) {
    byte ipaddr[4] = {0};
    IPAddress currentIP;
    readFromEEPROM(EEPROM_IP_ADDR_ADDRESS, 4, ipaddr);
    if (ipaddr[0] == 0 || ipaddr[0] == 0xFF) {
      currentIP = defaultIP;
    } else {
      currentIP = IPAddress(ipaddr[0], ipaddr[1], ipaddr[2], ipaddr[3]);
    }

    byte cidr[1] = {0};
    readFromEEPROM(EEPROM_CIDR_ADDRESS, 1, cidr);
    if (cidr[0] == 0 || cidr[0] == 0xFF) {
      cidr[0] = 24;
    }

    byte gw[4] = {0};
    IPAddress currentGateway;
    readFromEEPROM(EEPROM_GATEWAY_ADDRESS, 4, gw);
    if (ipaddr[0] == 0 || ipaddr[0] == 0xFF) {
      currentGateway = defaultGateway;
    } else {
      currentGateway = IPAddress(gw[0], gw[1], gw[2], gw[3]);
    }

    data += ((uint64_t)currentIP[0] << 48);
    data += ((uint64_t)currentIP[1] << 40);
    data += ((uint64_t)currentIP[2] << 32);
    data += ((uint64_t)currentIP[3] << 24);

    data += ((uint64_t) cidr[0] << 16);

    data += ((uint64_t)currentGateway[2] << 8);
    data += (uint64_t)currentGateway[3];
  } else if (configType == 2) {
    byte configCIDR[1] = {0};

    data += ((uint64_t)ip[0] << 48);
    data += ((uint64_t)ip[1] << 40);
    data += ((uint64_t)ip[2] << 32);
    data += ((uint64_t)ip[3] << 24);

    uint8_t configCidr = netmaskToCIDR(netmask);
    data += ((uint64_t) configCidr << 16);

    data += ((uint64_t) gateway[2] << 8);
    data += (uint64_t) gateway[3];
  } else if (configType == 3) {
    // Cannot load mac from ethernet so we read eeprom
    byte macAddress[6];
    readFromEEPROM(EEPROM_MAC_ADDRESS, 6, macAddress);
    if (macAddress[0] == 0 || macAddress[0] == 0xFF) {
      memcpy(macAddress, defaultMac, 6);
    }
    for (int i = 0; i < 6; i++) {
      data += ((uint64_t)macAddress[i] << (40 - (i * 8)));
    }
  }
  return data;
}

uint8_t processType71(uint64_t intValue) {
  uint8_t part[4];
  for (int i = 0; i < 4; i++) {
    part[i] = (intValue >> 48 - (8 * i)) & 0xFF;
    if (part[i] < 0 || part[i] > 255) {
      return 0xFF;
    }
    if (i == 0 && part[i] < 1) {
      return 0xFF;
    }
  }

  // Save to eeprom must use bytearray
  uint8_t cidr[1] = {(intValue >> 16) & 0xFF};
  if (cidr[0] < 13 || cidr[0] > 32) {
    return 0xFF;
  }

  uint8_t gw[2] = {(intValue >> 8) & 0xFF, intValue & 0xFF};
  for (int i = 0; i < 2; i++) {
    gw[i] = (intValue >> 8 - (8 * i)) & 0xFF;
    if (part[i] < 0 || part[i] > 255) {
      return 0xFF;
    }
    if (i == 1 && gw[i] == 0) {
      return 0xFF;
    }
  }

  byte newIP[4] = {part[0], part[1], part[2], part[3]};
  byte newGateway[4] = {part[0], part[1], gw[0], gw[1]};

  writeToEEPROM(EEPROM_IP_ADDR_ADDRESS, 4, newIP);

  // Only update if non dhcp
  if (part[0] > 0) {
    writeToEEPROM(EEPROM_CIDR_ADDRESS, 1, cidr);
    writeToEEPROM(EEPROM_GATEWAY_ADDRESS, 4, newGateway);
  }

  return 0xFC;
}

uint8_t processType72(uint64_t intValue) {
  uint8_t newMac[6];
  for (int i = 0; i < 6; i++) {
    newMac[i] = (intValue >> 40 - (8 * i)) & 0xFF;
  }

  writeToEEPROM(EEPROM_MAC_ADDRESS, 6, newMac);

  return 0xFC;
}

uint8_t processType73(uint64_t intValue) {
  int commandBit = intValue >> 52 & 0xF;
  int keyOffset = intValue >> 48 & 0xF;

  setBufferConfig(commandBit, keyOffset,  40, intValue);

  if (commandBit == 2) {
    writeToEEPROM(EEPROM_AESKEY_ADDRESS, 16, bufferConfig);
    memcpy(aesKey, bufferConfig, 16);
    memset(bufferConfig, 0, sizeof(bufferConfig));
    return 0xFB;
  }

  return 0x00;
}

uint8_t processType77(uint64_t intValue) {
  int state = intValue & 0xFF;

  byte stateByte[1] = {0};
  if (state > 0) {
    stateByte[0] = 0x01;
  } else {
    stateByte[1] = 0x00;
  }
  
  writeToEEPROM(EEPROM_PIN_STATE, 1, stateByte);

  return 0xFC;
}

uint8_t processType78(uint64_t intValue) {
  byte value[2] = {(intValue >> 8) & 0xFF, intValue & 0xFF}; 
  writeToEEPROM(EEPROM_BLINK_DELAY, 2, value);

  return 0xFC;
}

uint8_t processType79(uint64_t intValue) {
  byte value[1] = {intValue & 0xFF}; 
  writeToEEPROM(EEPROM_LOOP_DELAY, 1, value);

  return 0xFC;
}


// Buffer config to memory without committing to EEPROM
// Make sure to reset bufferConfig first
void setBufferConfig(int commandBit, int keyOffset, int valueShift, uint64_t intValue) {
  if (commandBit == 0) {
    memset(bufferConfig, 0, sizeof(bufferConfig));
  }

  if (commandBit == 2) {
    return;
  }

  if (keyOffset > 5) {
    keyOffset = 5;
  }

  keyOffset *= 6;

  for (int i = 0; i < 6; i++) {
    if (i + keyOffset > 32) {
      break;
    }
    int ascii = (intValue >> valueShift - (8 * i)) & 0xFF;
    if (ascii < 32 || ascii > 126) {
      continue;
    }
    bufferConfig[i + keyOffset] = ascii;
  }
}

uint8_t processType7F(uint64_t intValue) {
  //  Reset everything
  byte resetVal[1] = {0xFF};
  writeToEEPROM(EEPROM_MAC_ADDRESS, 1, resetVal);
  writeToEEPROM(EEPROM_IP_ADDR_ADDRESS, 1, resetVal);
  writeToEEPROM(EEPROM_CIDR_ADDRESS, 1, resetVal);
  writeToEEPROM(EEPROM_GATEWAY_ADDRESS, 1, resetVal);
  writeToEEPROM(EEPROM_AESKEY_ADDRESS, 1, resetVal);
  writeToEEPROM(EEPROM_PIN_STATE, 1, resetVal); 
  writeToEEPROM(EEPROM_BLINK_DELAY, 1, resetVal);
  writeToEEPROM(EEPROM_LOOP_DELAY, 1, resetVal);
  return 0xFC;
}

void blink() {
  unsigned long currentMillis = millis();

  for (int i = 2; i <= 49; i++) {
    if (blinkIO[i].blinkCount == 0) {
      continue;
    }

    unsigned long elaspedTime = currentMillis - blinkIO[i].lastRun;

    // rollover after 50 days
    if (currentMillis < blinkIO[i].lastRun) {
      elaspedTime = (ULONG_MAX - blinkIO[i].lastRun) + currentMillis;
    }

    if (elaspedTime < blinkDelay) {
      continue;
    }

    blinkIO[i].lastRun = currentMillis;
    blinkIO[i].blinkCount--;

    if (blinkIO[i].blinkCount == 0) {
      digitalWrite(i, blinkIO[i].afterBlink);
    } else {
      digitalWrite(i, !digitalRead(i));
    }
  }
}

IPAddress cidrToNetmask(uint8_t cidr) {
  uint32_t mask = ~(0xFFFFFFFF >> cidr);
  return IPAddress((mask >> 24) & 0xFF, (mask >> 16) & 0xFF, (mask >> 8) & 0xFF, mask & 0xFF);
}

uint8_t netmaskToCIDR(IPAddress netmask) {
  int cidr = 0;
  for (int i = 0; i < 4; i++) {
    byte octet = netmask[i];
    while (octet) {
      cidr += (octet & 0x80) ? 1 : 0;
      octet <<= 1;
    }
  }
  return cidr;
}

void loadEEPROM() {
  byte newMac[6] = {0};
  readFromEEPROM(EEPROM_MAC_ADDRESS, 6, newMac);
  if (newMac[0] == 0 || newMac[0] == 0xFF) {
    memcpy(mac, defaultMac, 6);
  } else {
    memcpy(mac, newMac, 6);
  }

  byte ipaddr[4] = {0};
  readFromEEPROM(EEPROM_IP_ADDR_ADDRESS, 4, ipaddr);
  if (ipaddr[0] == 0 || ipaddr[0] == 0xFF) {
    ip = defaultIP;
  } else {
    ip = IPAddress(ipaddr[0], ipaddr[1], ipaddr[2], ipaddr[3]);
  }

  byte cidr[1] = {0};
  readFromEEPROM(EEPROM_CIDR_ADDRESS, 1, cidr);
  if (cidr[0] == 0 || cidr[0] == 0xFF) {
    netmask = IPAddress(255, 255, 255, 0);
  } else {
    netmask = cidrToNetmask(cidr[0]);
  }

  byte gw[4] = {0};
  readFromEEPROM(EEPROM_GATEWAY_ADDRESS, 4, gw);
  if (ipaddr[0] == 0 || ipaddr[0] == 0xFF) {
    gateway = defaultGateway;
  } else {
    gateway = IPAddress(gw[0], gw[1], gw[2], gw[3]);
  }


  // Aeskey is a bit dangerous if found error always reset the aeskey
  // aeskey can only be combination of 0-9 and a-z characters
  bool invalidAesKey = false;
  byte newAesKey[16] = {0};
  readFromEEPROM(EEPROM_AESKEY_ADDRESS, 16, newAesKey);
  for (int i = 0; i < 16; i++) {
    if (i == 0 && (newAesKey[0] == 0 || newAesKey[0] == 0xFF)) {
      invalidAesKey = true;
      break;
    }
    if (!((newAesKey[i] >= 0x30 && newAesKey[i] <= 0x39) || (newAesKey[i] >= 0x61 && newAesKey[i] <= 0x7A))) {
      invalidAesKey = true;
      break;
    }
  }
  if (invalidAesKey) {
    memcpy(aesKey, defaultAesKey, 16);
  } else {
    memcpy(aesKey, newAesKey, 16);
  }

  byte state[1] = {0};
  readFromEEPROM(EEPROM_PIN_STATE, 1, state);
  if (state[0] > 0 || state[0] == 0xFF) {
    STATE_ON = HIGH;
  } else {
    STATE_ON = LOW;
  }
  STATE_OFF = !STATE_ON;

  byte configBlink[2] = {0};
  readFromEEPROM(EEPROM_BLINK_DELAY, 2, configBlink);
  if (configBlink[0] == 0 || configBlink[0] == 0xFF) {
    blinkDelay = 1000;
  } else {
    blinkDelay = (configBlink[0] << 8) + configBlink[1];
  }
  
  byte configDelay[1] = {0};
  readFromEEPROM(EEPROM_LOOP_DELAY, 1, configDelay);
  if (configDelay[0] == 0 || configDelay[0] == 0xFF) {
    loopDelay = 0;
  } else {
    loopDelay = configDelay[0];
  }
}

void writeToEEPROM(int startAddress, int length, byte * data) {
  for (int i = 0; i < length; i++) {
    EEPROM.write(startAddress + i, data[i]);
  }
}

void readFromEEPROM(int startAddress, int length, byte * output) {
  for (int i = 0; i < length; i++) {
    output[i] = EEPROM.read(startAddress + i);
  }
}
