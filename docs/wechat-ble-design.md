# 微信小程序蓝牙适配方案设计

## 背景

niimbluelib 当前支持：
- Web Bluetooth API（`bluetooth_impl.ts`）
- Capacitor BLE（`capacitor_ble_impl.ts`）
- Serial（`serial_impl.ts`）

需要新增微信小程序蓝牙支持，同时考虑未来可能支持其他平台（如 uni-app、Taro 等）。

## 现有架构

```
NiimbotAbstractClient (abstract_client.ts)
    ├─ NiimbotBluetoothClient (bluetooth_impl.ts)      → Web Bluetooth
    ├─ NiimbotCapacitorBleClient (capacitor_ble_impl.ts) → Capacitor
    └─ NiimbotSerialClient (serial_impl.ts)            → Serial
```

每新增一个平台，需新增一个完整的 Client 实现类，存在大量重复代码。

## 新架构：Adapter + Facade

### 设计目标

1. **核心通信逻辑复用**：连接、读写、通知等底层操作只需实现一次
2. **设备发现流程适配**：不同平台的设备发现机制差异通过 Facade 层抹平
3. **易于扩展**：新增平台只需实现 Adapter，无需重写整个 Client

### 架构分层

```
┌─────────────────────────────────────────────────────────┐
│  用户代码                                                │
│  client.connect({ onDeviceFound: ... })                 │
├─────────────────────────────────────────────────────────┤
│  NiimbotBleFacade (extends NiimbotAbstractClient)       │
│  ├─ connect(options): 统一入口                          │
│  │   ├─ 平台检测 (web / wechat / capacitor)            │
│  │   ├─ 设备发现流程适配                                │
│  │   │   ├─ Web: navigator.bluetooth.requestDevice()   │
│  │   │   ├─ 微信: startDiscovery + 回调选择            │
│  │   │   └─ Capacitor: BleClient.requestDevice()       │
│  │   └─ 调用 adapter.connectDevice(deviceId)           │
│  ├─ disconnect(): 调用 adapter                          │
│  ├─ sendRaw(): 调用 adapter                             │
│  └─ isConnected(): 调用 adapter                         │
├─────────────────────────────────────────────────────────┤
│  BluetoothAdapter (interface)                           │
│  ├─ initialize(): Promise<void>                        │
│  ├─ connectDevice(deviceId): Promise<void>              │
│  ├─ findSuitableCharacteristic(): Promise<CharInfo>    │
│  ├─ startNotifications(callback): Promise<void>         │
│  ├─ writeWithoutResponse(data): Promise<void>           │
│  ├─ disconnect(): Promise<void>                         │
│  ├─ isConnected(): boolean                              │
│  │                                                      │
│  │  微信专用扩展方法 (WechatBluetoothAdapter):          │
│  ├─ startDiscovery(filters): Promise<void>              │
│  ├─ stopDiscovery(): Promise<void>                      │
│  ├─ getDiscoveredDevices(): Promise<BleDevice[]>        │
├─────────────────────────────────────────────────────────┤
│  Adapter 实现                                           │
│  ├─ WebBluetoothAdapter                                 │
│  ├─ WechatBluetoothAdapter                              │
│  └─ CapacitorBluetoothAdapter (可选，复用现有实现)      │
└─────────────────────────────────────────────────────────┘
```

### 接口定义

#### BluetoothAdapter

```typescript
export interface CharacteristicInfo {
  serviceUUID: string;
  characteristicUUID: string;
}

export interface BleDevice {
  deviceId: string;
  name?: string;
  rssi?: number;  // 微信小程序有，Web Bluetooth 无
}

export interface BluetoothAdapter {
  /** 初始化适配器（微信需调用 wx.openBluetoothAdapter） */
  initialize(): Promise<void>;

  /** 连接到指定设备 */
  connectDevice(deviceId: string): Promise<void>;

  /** 查找合适的特征值（支持 notify + writeWithoutResponse） */
  findSuitableCharacteristic(deviceId: string): Promise<CharacteristicInfo>;

  /** 启动特征值变化通知 */
  startNotifications(
    deviceId: string,
    serviceUUID: string,
    characteristicUUID: string,
    callback: (data: Uint8Array) => void
  ): Promise<void>;

  /** 写入数据（无响应模式） */
  writeWithoutResponse(
    deviceId: string,
    serviceUUID: string,
    characteristicUUID: string,
    data: Uint8Array
  ): Promise<void>;

  /** 断开连接 */
  disconnect(deviceId: string): Promise<void>;

  /** 检查连接状态 */
  isConnected(deviceId: string): boolean;

  /** 释放适配器资源（微信需调用 wx.closeBluetoothAdapter） */
  release(): Promise<void>;
}
```

#### Facade Options

```typescript
export interface ConnectOptions {
  /** 直接连接已知设备（跳过发现流程） */
  deviceId?: string;

  /** 设备发现回调（上层控制设备选择逻辑） */
  onDeviceFound?: (devices: BleDevice[]) => BleDevice | null | Promise<BleDevice | null>;

  /** 自动选择第一个匹配的设备 */
  autoSelectFirst?: boolean;

  /** 设备名称过滤器 */
  namePrefix?: string[];

  /** 超时时间（毫秒） */
  timeout?: number;
}
```

### 平台差异处理

#### Web Bluetooth

```typescript
class WebBluetoothAdapter implements BluetoothAdapter {
  private gattServer?: BluetoothRemoteGATTServer;
  private characteristic?: BluetoothRemoteGATTCharacteristic;

  initialize(): Promise<void> {
    // Web Bluetooth 无需初始化
    return Promise.resolve();
  }

  connectDevice(deviceId: string): Promise<void> {
    // Web Bluetooth 不支持按 deviceId 连接
    // deviceId 实际是 device 对象，由 requestDevice() 返回
    // 此方法在 Web 环境下不应直接调用
    throw new Error('Use requestDevice() for Web Bluetooth');
  }
}

// Facade 中的 Web 处理
async connect(options: ConnectOptions): Promise<ConnectionInfo> {
  if (platform === 'web') {
    const device = await navigator.bluetooth.requestDevice({
      filters: [...]
    });
    await device.gatt.connect();
    // 后续操作使用 device.gatt
  }
}
```

#### 微信小程序

```typescript
class WechatBluetoothAdapter implements BluetoothAdapter {
  private connectedDeviceId?: string;

  initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      wx.openBluetoothAdapter({
        success: () => resolve(),
        fail: (err) => reject(new Error(err.errMsg))
      });
    });
  }

  connectDevice(deviceId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      wx.createBLEConnection({
        deviceId,
        success: () => {
          this.connectedDeviceId = deviceId;
          resolve();
        },
        fail: (err) => reject(new Error(err.errMsg))
      });
    });
  }

  startDiscovery(filters: DiscoveryFilters): Promise<void> {
    return new Promise((resolve, reject) => {
      wx.startBluetoothDevicesDiscovery({
        services: filters.services,
        allowDuplicatesOnly: false,
        success: () => resolve(),
        fail: (err) => reject(new Error(err.errMsg))
      });
    });
  }

  getDiscoveredDevices(): Promise<BleDevice[]> {
    return new Promise((resolve, reject) => {
      wx.getBluetoothDevices({
        success: (res) => resolve(res.devices.map(d => ({
          deviceId: d.deviceId,
          name: d.name,
          rssi: d.RSSI
        }))),
        fail: (err) => reject(new Error(err.errMsg))
      });
    });
  }

  writeWithoutResponse(
    deviceId: string,
    serviceUUID: string,
    characteristicUUID: string,
    data: Uint8Array
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      wx.writeBLECharacteristicValue({
        deviceId,
        serviceId: serviceUUID,
        characteristicId: characteristicUUID,
        value: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
        success: () => resolve(),
        fail: (err) => reject(new Error(err.errMsg))
      });
    });
  }
}

// Facade 中的微信处理
async connect(options: ConnectOptions): Promise<ConnectionInfo> {
  if (platform === 'wechat') {
    const adapter = this.adapter as WechatBluetoothAdapter;

    await adapter.initialize();

    if (options.deviceId) {
      // 直接连接
      await this._connectViaAdapter(options.deviceId);
      return this._finalizeConnect(options.deviceId);
    }

    // 开始扫描
    await adapter.startDiscovery({ services: BleDefaultConfiguration.SERVICES });

    if (options.autoSelectFirst) {
      const devices = await adapter.getDiscoveredDevices();
      const target = devices.find(d =>
        options.namePrefix?.some(p => d.name?.startsWith(p)) ?? true
      );
      if (!target) throw new Error('No device found');
      await adapter.stopDiscovery();
      await this._connectViaAdapter(target.deviceId);
      return this._finalizeConnect(target.deviceId);
    }

    if (options.onDeviceFound) {
      // 轮询等待设备发现 + 用户选择
      const selected = await this._waitForDeviceSelection(adapter, options);
      await adapter.stopDiscovery();
      await this._connectViaAdapter(selected.deviceId);
      return this._finalizeConnect(selected.deviceId);
    }

    throw new Error('Provide deviceId, autoSelectFirst, or onDeviceFound');
  }
}
```

### 文件结构

```
src/
├─ adapter/
│   ├─ bluetooth_adapter.ts        # 接口定义
│   ├─ web_adapter.ts              # Web Bluetooth 实现
│   ├─ wechat_adapter.ts           # 微信小程序实现
│   ├─ capacitor_adapter.ts        # Capacitor 实现（可选）
│   └─ index.ts                    # 导出
├─ client/
│   ├─ abstract_client.ts          # 现有，不变
│   ├─ ble_facade.ts               # 新增：Facade 实现
│   ├─ bluetooth_impl.ts           # 可删除或标记 deprecated
│   ├─ capacitor_ble_impl.ts       # 可删除或标记 deprecated
│   └─ index.ts                    # 更新导出
```

### 兼容性考虑

1. **保留现有实现**：`bluetooth_impl.ts` 和 `capacitor_ble_impl.ts` 暂不删除，标记 deprecated
2. **渐进迁移**：新增 `ble_facade.ts`，用户可选择使用 Facade 或原有 Client
3. **类型安全**：微信小程序 API 使用 `@types/wechat-miniprogram` 或自定义类型

### 微信小程序类型定义

```typescript
// 若无 @types/wechat-miniprogram，自定义最小类型集
declare namespace WechatMiniprogram {
  interface BluetoothDevice {
    deviceId: string;
    name: string;
    RSSI: number;
    advertisData: ArrayBuffer;
  }

  interface OpenBluetoothAdapterOption {
    success?: (res: any) => void;
    fail?: (res: { errMsg: string }) => void;
  }
}

// 全局 wx 对象
declare const wx: {
  openBluetoothAdapter(options: any): void;
  closeBluetoothAdapter(options: any): void;
  startBluetoothDevicesDiscovery(options: any): void;
  stopBluetoothDevicesDiscovery(options: any): void;
  getBluetoothDevices(options: any): void;
  createBLEConnection(options: any): void;
  closeBLEConnection(options: any): void;
  getBLEDeviceServices(options: any): void;
  getBLEDeviceCharacteristics(options: any): void;
  notifyBLECharacteristicValueChange(options: any): void;
  writeBLECharacteristicValue(options: any): void;
  onBLECharacteristicValueChange(callback: (res: { deviceId: string; serviceId: string; characteristicId: string; value: ArrayBuffer }) => void): void;
};
```

### 使用示例

#### Web 环境

```typescript
import { NiimbotBleFacade } from '@mmote/niimbluelib';

const client = new NiimbotBleFacade('web');
await client.connect();  // 浏览器弹出设备选择对话框
const info = await client.fetchPrinterInfo();
await client.printImage(imageData);
await client.disconnect();
```

#### 微信小程序 - 简单场景

```typescript
import { NiimbotBleFacade } from '@mmote/niimbluelib';

const client = new NiimbotBleFacade('wechat');
await client.connect({ autoSelectFirst: true, namePrefix: ['B', 'D'] });
// 自动选择第一个名称以 B 或 D 开头的设备
```

#### 微信小程序 - 自定义设备选择 UI

```typescript
const client = new NiimbotBleFacade('wechat');

// 方式1: 回调模式
await client.connect({
  onDeviceFound: (devices) => {
    // 渲染设备列表供用户选择
    this.setData({ deviceList: devices });
    return null;  // 先返回 null，等用户点击
  }
});

// 用户点击设备列表项后
client.selectDevice(selectedDeviceId);

// 方式2: Promise 模式（配合外部 UI）
const connectPromise = client.prepareConnect();
await connectPromise.ready;  // 等待设备发现完成
const devices = connectPromise.getDevices();
// 渲染 UI，用户选择后
await connectPromise.selectAndConnect(userSelectedDevice);
```

### 待讨论问题

1. **平台检测方式**：
   - 运行时检测 `typeof navigator.bluetooth` / `typeof wx`
   - 还是构造时传入 `new NiimbotBleFacade('wechat')`

2. **微信小程序打包**：
   - 微信小程序不支持 npm 的部分特性
   - 是否需要单独构建小程序版本（如 `dist/miniprogram/`）

3. **onDeviceFound 回调设计**：
   - 单次回调返回所有设备
   - 还是持续回调每次发现新设备

4. **Capacitor 迁移**：
   - 是否将现有 `capacitor_ble_impl.ts` 迁移到 adapter
   - 还是保持独立，只对 Web + 微信使用 Facade