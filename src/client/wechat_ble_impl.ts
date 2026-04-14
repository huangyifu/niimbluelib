import { ConnectEvent, DisconnectEvent, RawPacketSentEvent } from "../events";
import { ConnectionInfo, NiimbotAbstractClient, NIIMBOT_CLIENT_DEFAULTS } from "./abstract_client";
import { ConnectResult } from "../packets";
import { Utils } from "../utils";
import { modelsLibrary } from "../printer_models";
import {
  WechatWx,
  WechatBleDevice,
  WechatBleService,
  WechatBleCharacteristic,
  WechatDiscoveryFilters,
  NiimbotWechatBleClientConnectOptions,
  WechatCharacteristicValueChangeCallback,
  WechatConnectionStateChangeCallback,
  WechatGetServicesSuccess,
  WechatGetCharacteristicsSuccess,
} from "./wechat_types";

/**
 * Default BLE configuration for NIIMBOT printers
 *
 * @category Client
 */
export class WechatBleDefaultConfiguration {
  /**
   * NIIMBOT printer service UUID
   */
  public static readonly SERVICE_UUID = "e7810a71-73ae-499d-8c15-faa9aef0c3f2";

  /**
   * Default MTU for BLE writes (WeChat default is ~20 bytes)
   */
  public static readonly DEFAULT_MTU = 20;

  /**
   * Device name prefixes for NIIMBOT printers (B-series, D-series, etc.)
   */
  public static readonly NAME_PREFIXES = ["B", "D", "N"];
}

/**
 * Promise wrapper for WeChat callback-style API
 */
function wechatPromise<T>(
  fn: (options: { success: (res: T) => void; fail: (res: { errMsg: string }) => void }) => void
): Promise<T> {
  return new Promise((resolve, reject) => {
    fn({
      success: (res: T) => resolve(res),
      fail: (res: { errMsg: string }) => reject(new Error(res.errMsg)),
    });
  });
}

/**
 * Get wx global object (throws if not in WeChat environment)
 */
function getWx(): WechatWx {
  // In WeChat Mini Program, wx is globally available
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wx = (globalThis as any).wx;
  if (!wx) {
    throw new Error("wx is not available. This client only works in WeChat Mini Program environment.");
  }
  return wx as WechatWx;
}

/**
 * Uses WeChat Mini Program Bluetooth LE API
 *
 * Reuse points (from NiimbotAbstractClient):
 * - Packet handling, negotiation, mutex, heartbeat, events
 *
 * Transport operations are specific to WeChat:
 * - connect/disconnect/write/notify via wx BLE API
 *
 * @category Client
 */
export class NiimbotWechatBleClient extends NiimbotAbstractClient {
  private wx: WechatWx;
  private deviceId?: string;
  private serviceUUID?: string;
  private characteristicUUID?: string;
  private mtu: number = WechatBleDefaultConfiguration.DEFAULT_MTU;

  /** Discovered devices cache for discovery session */
  private discoveredDevices: Map<string, WechatBleDevice> = new Map();

  /** Discovery state */
  private isDiscovering: boolean = false;

  /** Device found callback reference */
  private deviceFoundCallback?: (res: { devices: WechatBleDevice[] }) => void;

  /** Connection state callback reference */
  private connectionStateCallback?: (res: WechatConnectionStateChangeCallback) => void;

  /** Characteristic value change callback reference */
  private characteristicValueCallback?: (res: WechatCharacteristicValueChangeCallback) => void;

  constructor() {
    super();
    this.wx = getWx();
  }

  /**
   * Get current device ID
   */
  public getDeviceId(): string | undefined {
    return this.deviceId;
  }

  /**
   * Get current MTU value
   */
  public getMtu(): number {
    return this.mtu;
  }

  /**
   * Set MTU value (for chunked writes)
   */
  public setMtu(mtu: number): void {
    this.mtu = mtu;
  }

  /**
   * Initialize Bluetooth adapter
   */
  private async initializeAdapter(): Promise<void> {
    await wechatPromise((opts) => this.wx.openBluetoothAdapter(opts));
  }

  /**
   * Close Bluetooth adapter
   */
  private async closeAdapter(): Promise<void> {
    await wechatPromise((opts) => this.wx.closeBluetoothAdapter(opts));
  }

  /**
   * Start device discovery with event-driven collection
   */
  private async startDiscovery(filters: WechatDiscoveryFilters): Promise<void> {
    this.discoveredDevices.clear();
    this.isDiscovering = true;

    // Register device found callback (event-driven)
    this.deviceFoundCallback = (res: { devices: WechatBleDevice[] }) => {
      for (const device of res.devices) {
        // Dedupe by deviceId
        if (!this.discoveredDevices.has(device.deviceId)) {
          this.discoveredDevices.set(device.deviceId, device);
        }
      }
    };
    this.wx.onBluetoothDeviceFound(this.deviceFoundCallback);

    // Start discovery
    await wechatPromise((opts) =>
      this.wx.startBluetoothDevicesDiscovery({
        services: filters.services ?? [WechatBleDefaultConfiguration.SERVICE_UUID],
        allowDuplicatesOnly: false,
        success: opts.success,
        fail: opts.fail,
      })
    );
  }

  /**
   * Stop device discovery
   */
  private async stopDiscovery(): Promise<void> {
    if (!this.isDiscovering) return;

    this.isDiscovering = false;

    // Remove callback
    if (this.deviceFoundCallback) {
      this.wx.offBluetoothDeviceFound(this.deviceFoundCallback);
      this.deviceFoundCallback = undefined;
    }

    await wechatPromise((opts) => this.wx.stopBluetoothDevicesDiscovery(opts));
  }

  /**
   * Get all discovered devices
   */
  private getDiscoveredDevices(): WechatBleDevice[] {
    return Array.from(this.discoveredDevices.values());
  }

  /**
   * Filter devices by name/localName prefix
   */
  private filterDevices(devices: WechatBleDevice[], namePrefix?: string[]): WechatBleDevice[] {
    if (!namePrefix || namePrefix.length === 0) {
      return devices;
    }
    return devices.filter((d) => {
      const name = d.name || d.localName || "";
      return namePrefix.some((prefix) => name.startsWith(prefix));
    });
  }

  /**
   * Find suitable characteristic (notify && writeNoResponse)
   * Complete sequence per Codex review
   */
  private async findSuitableCharacteristic(deviceId: string): Promise<{ serviceUUID: string; characteristicUUID: string }> {
    // Get services
    const servicesRes = await wechatPromise<WechatGetServicesSuccess>((opts) => this.wx.getBLEDeviceServices({ deviceId, ...opts }));
    const services: WechatBleService[] = servicesRes.services;

    for (const service of services) {
      // Skip short UUIDs (likely standard services)
      if (service.uuid.length < 5) continue;

      // Get characteristics for this service
      const charsRes = await wechatPromise<WechatGetCharacteristicsSuccess>((opts) =>
        this.wx.getBLEDeviceCharacteristics({
          deviceId,
          serviceId: service.uuid,
          ...opts,
        })
      );
      const characteristics: WechatBleCharacteristic[] = charsRes.characteristics;

      for (const char of characteristics) {
        const props = char.properties;
        // Find characteristic with notify AND writeNoResponse/write
        if (props.notify && (props.writeNoResponse || props.write)) {
          return {
            serviceUUID: service.uuid,
            characteristicUUID: char.uuid,
          };
        }
      }
    }

    throw new Error("Unable to find suitable characteristic (notify + writeNoResponse/write)");
  }

  /**
   * Connect to specific device (internal)
   */
  private async connectToDevice(deviceId: string, timeout?: number): Promise<void> {
    // Create BLE connection
    await wechatPromise((opts) =>
      this.wx.createBLEConnection({
        deviceId,
        timeout: timeout ?? 10000,
        ...opts,
      })
    );

    // Register connection state change callback
    this.connectionStateCallback = (res: WechatConnectionStateChangeCallback) => {
      if (res.deviceId === this.deviceId && !res.connected) {
        this.cleanup();
        this.emit("disconnect", new DisconnectEvent());
      }
    };
    this.wx.onBLEConnectionStateChange(this.connectionStateCallback);

    // Find suitable characteristic
    const { serviceUUID, characteristicUUID } = await this.findSuitableCharacteristic(deviceId);

    // Store connection info
    this.deviceId = deviceId;
    this.serviceUUID = serviceUUID;
    this.characteristicUUID = characteristicUUID;

    // Try to get MTU (optional, may not be supported)
    try {
      const mtuRes = await wechatPromise<{ mtu: number }>((opts) =>
        this.wx.getBLEMTU({ deviceId, ...opts })
      );
      this.mtu = mtuRes.mtu;
    } catch {
      // MTU not available, use default
      this.mtu = WechatBleDefaultConfiguration.DEFAULT_MTU;
    }

    if (this.debug) {
      console.log(`Suitable characteristic found: service=${serviceUUID}, char=${characteristicUUID}, mtu=${this.mtu}`);
    }

    // Enable notifications
    await wechatPromise((opts) =>
      this.wx.notifyBLECharacteristicValueChange({
        deviceId,
        serviceId: serviceUUID,
        characteristicId: characteristicUUID,
        state: true,
        ...opts,
      })
    );

    // Register characteristic value change callback
    this.characteristicValueCallback = (res: WechatCharacteristicValueChangeCallback) => {
      if (res.deviceId === this.deviceId) {
        // Convert ArrayBuffer to Uint8Array for processRawPacket
        const data = new Uint8Array(res.value);
        this.processRawPacket(data);
      }
    };
    this.wx.onBLECharacteristicValueChange(this.characteristicValueCallback);
  }

  /**
   * Cleanup connection state
   */
  private cleanup(): void {
    // Remove callbacks
    if (this.connectionStateCallback) {
      this.wx.offBLEConnectionStateChange(this.connectionStateCallback);
      this.connectionStateCallback = undefined;
    }
    if (this.characteristicValueCallback) {
      this.wx.offBLECharacteristicValueChange(this.characteristicValueCallback);
      this.characteristicValueCallback = undefined;
    }

    this.deviceId = undefined;
    this.serviceUUID = undefined;
    this.characteristicUUID = undefined;
    this.info = {};
    this.discoveredDevices.clear();
  }

  /**
   * Connect to printer
   *
   * Two modes:
   * 1. deviceId provided: direct connect
   * 2. onDeviceFound or autoSelectFirst: discovery + selection
   */
  public async connect(options?: NiimbotWechatBleClientConnectOptions): Promise<ConnectionInfo> {
    await this.disconnect();

    // Initialize adapter
    await this.initializeAdapter();

    let targetDevice: WechatBleDevice | undefined;

    try {
      if (options?.deviceId) {
        // Direct connect mode
        targetDevice = { deviceId: options.deviceId, name: options.deviceId, RSSI: 0 };
      } else {
        // Discovery mode
        const filters: WechatDiscoveryFilters = {
          services: options?.services ?? [WechatBleDefaultConfiguration.SERVICE_UUID],
          namePrefix: options?.namePrefix ?? WechatBleDefaultConfiguration.NAME_PREFIXES,
        };

        await this.startDiscovery(filters);

        if (options?.autoSelectFirst) {
          // Wait for devices with timeout
          const timeout = options?.discoveryTimeout ?? 10000;
          const startTime = Date.now();

          while (Date.now() - startTime < timeout) {
            const devices = this.filterDevices(this.getDiscoveredDevices(), filters.namePrefix);
            if (devices.length > 0) {
              targetDevice = devices[0];
              break;
            }
            await Utils.sleep(100);
          }

          if (!targetDevice) {
            throw new Error("No device found during discovery");
          }
        } else if (options?.onDeviceFound) {
          // User-controlled selection via callback
          const timeout = options?.discoveryTimeout ?? 10000;
          const startTime = Date.now();
          const callback = options.onDeviceFound;

          while (Date.now() - startTime < timeout) {
            const devices = this.filterDevices(this.getDiscoveredDevices(), filters.namePrefix);
            if (devices.length > 0) {
              const selected = await callback(devices);
              if (selected) {
                targetDevice = selected;
                break;
              }
            }
            await Utils.sleep(200); // Debounce interval
          }

          if (!targetDevice) {
            throw new Error("No device selected or discovery timeout");
          }
        } else {
          throw new Error("Provide deviceId, autoSelectFirst, or onDeviceFound");
        }

        await this.stopDiscovery();
      }

      // Connect to device
      await this.connectToDevice(targetDevice.deviceId, options?.connectionTimeout);

      // Run negotiation and fetch info (from NiimbotAbstractClient)
      try {
        await this.initialNegotiate();
        await this.fetchPrinterInfo();
      } catch (e) {
        console.error("Unable to fetch printer info.");
        console.error(e);
      }

      const result: ConnectionInfo = {
        deviceName: targetDevice.name || targetDevice.localName,
        result: this.info.connectResult ?? ConnectResult.FirmwareErrors,
      };

      this.emit("connect", new ConnectEvent(result));

      return result;
    } catch (e) {
      // Cleanup on failure
      await this.stopDiscovery();
      this.cleanup();
      throw e;
    }
  }

  /**
   * Check if connected
   */
  public isConnected(): boolean {
    return this.deviceId !== undefined;
  }

  /**
   * Disconnect from printer
   */
  public async disconnect(): Promise<void> {
    this.stopHeartbeat();

    if (this.deviceId !== undefined) {
      try {
        await wechatPromise((opts) => this.wx.closeBLEConnection({ deviceId: this.deviceId!, ...opts }));
      } catch {
        // Ignore disconnect errors
      }
    }

    this.cleanup();
  }

  /**
   * Send raw data to printer
   *
   * Chunks writes by MTU, preserves packetIntervalMs semantics
   */
  public async sendRaw(data: Uint8Array, force?: boolean): Promise<void> {
    const send = async () => {
      if (!this.isConnected()) {
        throw new Error("Not connected");
      }

      // Chunk by MTU
      const chunkSize = this.mtu;
      for (let i = 0; i < data.length; i += chunkSize) {
        const end = Math.min(i + chunkSize, data.length);
        const chunk = data.slice(i, end);

        // Preserve packetIntervalMs between chunks
        if (i > 0) {
          await Utils.sleep(this.packetIntervalMs);
        }

        // Write without response
        await wechatPromise((opts) =>
          this.wx.writeBLECharacteristicValue({
            deviceId: this.deviceId!,
            serviceId: this.serviceUUID!,
            characteristicId: this.characteristicUUID!,
            value: chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer,
            writeType: "writeNoResponse",
            ...opts,
          })
        );
      }

      this.emit("rawpacketsent", new RawPacketSentEvent(data));
    };

    if (force) {
      await send();
    } else {
      await this.mutex.runExclusive(send);
    }
  }

  /**
   * Release Bluetooth adapter (call when done with all printing)
   */
  public async release(): Promise<void> {
    await this.disconnect();
    try {
      await this.closeAdapter();
    } catch {
      // Ignore close errors
    }
  }

  /**
   * Get discovered devices (for custom UI scenarios)
   * Only available during active discovery session
   */
  public getAvailableDevices(): WechatBleDevice[] {
    return this.getDiscoveredDevices();
  }
}