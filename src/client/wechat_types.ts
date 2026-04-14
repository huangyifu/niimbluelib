/**
 * WeChat Mini Program Bluetooth LE API type definitions
 * Minimal subset for NIIMBOT printer communication
 *
 * @category Client
 */

/**
 * BLE device discovered via wx.startBluetoothDevicesDiscovery
 */
export interface WechatBleDevice {
  deviceId: string;
  name?: string;
  localName?: string;
  RSSI: number;
  advertisData?: ArrayBuffer;
  advertisServiceUUIDs?: string[];
}

/**
 * BLE service
 */
export interface WechatBleService {
  uuid: string;
  isPrimary: boolean;
}

/**
 * BLE characteristic properties
 */
export interface WechatBleCharacteristicProperties {
  read?: boolean;
  write?: boolean;
  writeNoResponse?: boolean;
  notify?: boolean;
  indicate?: boolean;
}

/**
 * BLE characteristic
 */
export interface WechatBleCharacteristic {
  uuid: string;
  properties: WechatBleCharacteristicProperties;
  value?: ArrayBuffer;
}

/**
 * Callback-based options pattern for WeChat API
 */
export interface WechatApiOptions<T = void> {
  success?: (res: T) => void;
  fail?: (res: { errMsg: string; errCode?: number }) => void;
  complete?: () => void;
}

/**
 * Success response for wx.openBluetoothAdapter
 */
export interface WechatOpenAdapterSuccess {
  isBluetoothAvailable: boolean;
}

/**
 * Success response for wx.startBluetoothDevicesDiscovery
 */
export interface WechatStartDiscoverySuccess {
  isDiscovering: boolean;
  devices: WechatBleDevice[];
}

/**
 * Success response for wx.getBluetoothDevices
 */
export interface WechatGetDevicesSuccess {
  devices: WechatBleDevice[];
}

/**
 * Success response for wx.getBLEDeviceServices
 */
export interface WechatGetServicesSuccess {
  services: WechatBleService[];
}

/**
 * Success response for wx.getBLEDeviceCharacteristics
 */
export interface WechatGetCharacteristicsSuccess {
  characteristics: WechatBleCharacteristic[];
}

/**
 * Callback for wx.onBLECharacteristicValueChange
 */
export interface WechatCharacteristicValueChangeCallback {
  deviceId: string;
  serviceId: string;
  characteristicId: string;
  value: ArrayBuffer;
}

/**
 * Callback for wx.onBLEConnectionStateChange
 */
export interface WechatConnectionStateChangeCallback {
  deviceId: string;
  connected: boolean;
}

/**
 * Options for wx.startBluetoothDevicesDiscovery
 */
export interface WechatStartDiscoveryOptions extends WechatApiOptions<WechatStartDiscoverySuccess> {
  services?: string[];
  allowDuplicatesOnly?: boolean;
  interval?: number;
}

/**
 * Options for wx.createBLEConnection
 */
export interface WechatCreateConnectionOptions extends WechatApiOptions<void> {
  deviceId: string;
  timeout?: number;
}

/**
 * Options for wx.getBLEDeviceServices
 */
export interface WechatGetServicesOptions extends WechatApiOptions<WechatGetServicesSuccess> {
  deviceId: string;
}

/**
 * Options for wx.getBLEDeviceCharacteristics
 */
export interface WechatGetCharacteristicsOptions extends WechatApiOptions<WechatGetCharacteristicsSuccess> {
  deviceId: string;
  serviceId: string;
}

/**
 * Options for wx.notifyBLECharacteristicValueChange
 */
export interface WechatNotifyCharacteristicOptions extends WechatApiOptions<void> {
  deviceId: string;
  serviceId: string;
  characteristicId: string;
  state: boolean;
}

/**
 * Options for wx.writeBLECharacteristicValue
 */
export interface WechatWriteCharacteristicOptions extends WechatApiOptions<void> {
  deviceId: string;
  serviceId: string;
  characteristicId: string;
  value: ArrayBuffer;
  writeType?: "write" | "writeNoResponse";
}

/**
 * Options for wx.closeBLEConnection
 */
export interface WechatCloseConnectionOptions extends WechatApiOptions<void> {
  deviceId: string;
}

/**
 * Global wx object interface (minimal subset for BLE)
 */
export interface WechatWx {
  openBluetoothAdapter(options: WechatApiOptions<WechatOpenAdapterSuccess>): void;
  closeBluetoothAdapter(options?: WechatApiOptions<void>): void;

  startBluetoothDevicesDiscovery(options: WechatStartDiscoveryOptions): void;
  stopBluetoothDevicesDiscovery(options?: WechatApiOptions<void>): void;
  getBluetoothDevices(options: WechatApiOptions<WechatGetDevicesSuccess>): void;

  onBluetoothDeviceFound(callback: (res: { devices: WechatBleDevice[] }) => void): void;
  offBluetoothDeviceFound(callback?: (res: { devices: WechatBleDevice[] }) => void): void;

  createBLEConnection(options: WechatCreateConnectionOptions): void;
  closeBLEConnection(options: WechatCloseConnectionOptions): void;

  getBLEDeviceServices(options: WechatGetServicesOptions): void;
  getBLEDeviceCharacteristics(options: WechatGetCharacteristicsOptions): void;

  notifyBLECharacteristicValueChange(options: WechatNotifyCharacteristicOptions): void;
  writeBLECharacteristicValue(options: WechatWriteCharacteristicOptions): void;

  onBLECharacteristicValueChange(callback: (res: WechatCharacteristicValueChangeCallback) => void): void;
  offBLECharacteristicValueChange(callback?: (res: WechatCharacteristicValueChangeCallback) => void): void;

  onBLEConnectionStateChange(callback: (res: WechatConnectionStateChangeCallback) => void): void;
  offBLEConnectionStateChange(callback?: (res: WechatConnectionStateChangeCallback) => void): void;

  getBLEMTU(options: WechatApiOptions<{ mtu: number }> & { deviceId: string }): void;
}

/**
 * Device discovery filters
 */
export interface WechatDiscoveryFilters {
  services?: string[];
  namePrefix?: string[];
}

/**
 * Connect options for NiimbotWechatBleClient
 */
export interface NiimbotWechatBleClientConnectOptions {
  /**
   * Skip device picker and connect to given device ID (BLE MAC address on Android)
   */
  deviceId?: string;

  /**
   * Device discovery callback - user controls device selection
   * Called only when new devices are found (not every poll cycle)
   * Return null to keep waiting, return device to select it
   */
  onDeviceFound?: (devices: WechatBleDevice[]) => WechatBleDevice | null | Promise<WechatBleDevice | null>;

  /**
   * Automatically select first matching device
   */
  autoSelectFirst?: boolean;

  /**
   * Device name/localName prefix filter
   */
  namePrefix?: string[];

  /**
   * Service UUID filter
   */
  services?: string[];

  /**
   * Discovery timeout in milliseconds
   * Default: 10000 (10s) for autoSelectFirst, 60000 (60s) for onDeviceFound
   */
  discoveryTimeout?: number;

  /**
   * Connection timeout in milliseconds (default 10000)
   */
  connectionTimeout?: number;
}