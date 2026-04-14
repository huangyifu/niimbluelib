# 微信小程序蓝牙适配方案设计

## 背景

niimbluelib 当前支持：
- Web Bluetooth API（`bluetooth_impl.ts`）
- Capacitor BLE（`capacitor_ble_impl.ts`）
- Serial（`serial_impl.ts`）

需要新增微信小程序蓝牙支持。

## 设计决策（已确定）

基于 Codex review 和讨论，以下问题已决定：

| 问题 | 决策 | 原因 |
|------|------|------|
| 架构模式 | 保持现有继承模式，不搞 Facade | Web 和微信设备发现流程本质不同，Facade 无法抹平 |
| 平台检测 | 构造时通过工厂方法 `instantiateClient('wechat-ble')` | 不搞运行时检测，类型安全 |
| 设备发现 | 事件驱动 `wx.onBluetoothDeviceFound` | 不搞轮询，避免竞态条件 |
| 打包入口 | 单独入口 `@mmote/niimbluelib/wechat` | 微信构建免 Capacitor/Web DOM import |
| Capacitor 迁移 | 保持独立，不迁移到 adapter | 首个 PR 只加微信，降低改动范围 |

## 最终架构

```
NiimbotAbstractClient（复用点：packet处理、协商、mutex、heartbeat、events）
    ├─ NiimbotBluetoothClient      → Web（独立 requestDevice 流程）
    ├─ NiimbotCapacitorBleClient   → Capacitor（独立 requestDevice 流程）
    ├─ NiimbotSerialClient         → Serial
    └─ NiimbotWechatBleClient      → 微信（新增，主动扫描流程）
```

**复用点说明**（Codex review 指出）：
- 真正复用的是 `NiimbotAbstractClient`：packet 处理、协商、mutex、heartbeat、events
- 传输层操作各客户端自行实现：connect/disconnect/write/notify

## 实现要点（Codex review 指出）

### 1. 完整连接序列
```
createBLEConnection → getBLEDeviceServices → getBLEDeviceCharacteristics
→ 选 notify && writeNoResponse/write 特征值
→ notifyBLECharacteristicValueChange({ state: true })
→ 注册 onBLECharacteristicValueChange + onBLEConnectionStateChange
```

### 2. 事件驱动设备发现
使用 `wx.onBluetoothDeviceFound` 收集去重设备，debounce 回调用户，强制 timeout。

### 3. BLE 写入分片
默认 20 字节（或按 MTU），保持 `packetIntervalMs` 语义。

### 4. 设备过滤
用 `name || localName` 过滤，因为微信设备 `name` 可能为空。

## 文件结构

```
src/
├─ client/
│   ├─ wechat_ble_impl.ts    # 微信蓝牙客户端实现
│   ├─ wechat_types.ts       # 微信 API 类型定义
│   └─ index.ts              # 更新：加 NiimbotWechatBleClient 导出
├─ wechat.ts                 # 微信专用入口（免 Capacitor/Web DOM）
└─ （其他现有文件不变）

package.json:
├─ exports:
│   ├─ ".": dist/cjs/index.js
│   └─ "./wechat": dist/cjs/wechat.js
└─ keywords: 加 "wechat", "miniprogram"
```

## 使用示例

### 微信小程序

```typescript
import { NiimbotWechatBleClient } from '@mmote/niimbluelib/wechat';

// 简单场景：自动选择第一个匹配设备
const client = new NiimbotWechatBleClient();
await client.connect({ autoSelectFirst: true, namePrefix: ['B', 'D'] });

// 自定义设备选择 UI
await client.connect({
  onDeviceFound: async (devices) => {
    // 渲染设备列表，用户选择后返回
    this.setData({ deviceList: devices });
    return null; // 先返回 null，等待用户点击
  }
});

// 已知设备 ID（如之前连接过）
await client.connect({ deviceId: 'XX:XX:XX:XX:XX:XX' });

// 打印
const info = await client.fetchPrinterInfo();
await client.printImage(imageData);

// 断开
await client.disconnect();
await client.release(); // 释放 adapter
```

### Web 环境（不变）

```typescript
import { NiimbotBluetoothClient } from '@mmote/niimbluelib';

const client = new NiimbotBluetoothClient();
await client.connect(); // 浏览器弹出设备选择对话框
```

## ConnectOptions 说明

```typescript
interface NiimbotWechatBleClientConnectOptions {
  deviceId?: string;          // 直接连接已知设备（跳过发现）
  onDeviceFound?: (devices: WechatBleDevice[]) => WechatBleDevice | null | Promise<...>;
                              // 用户控制设备选择，debounce 回调
  autoSelectFirst?: boolean;  // 自动选择第一个匹配设备
  namePrefix?: string[];      // 设备名称前缀过滤 ['B', 'D', 'N']
  services?: string[];        // Service UUID 过滤
  discoveryTimeout?: number;  // 发现超时（默认 10000ms）
  connectionTimeout?: number; // 连接超时（默认 10000ms）
}
```

## 已实现

- [x] `src/client/wechat_types.ts` - 微信 API 类型定义
- [x] `src/client/wechat_ble_impl.ts` - NiimbotWechatBleClient 实现
- [x] `src/wechat.ts` - 微信专用入口
- [x] `src/client/index.ts` - 更新导出
- [x] `package.json` - 添加 exports 和 keywords
- [x] TypeScript 编译通过