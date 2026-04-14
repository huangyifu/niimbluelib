/**
 * WeChat Mini Program entry point
 * Imports only WeChat-specific code, avoids Web DOM and Capacitor dependencies
 *
 * @module @mmote/niimbluelib/wechat
 */

// Core types and events (safe for WeChat)
export { NiimbotPacket, PacketParser, ResponseCommandId, ConnectResult } from "./packets";
export { PrinterInfo } from "./packets/dto";
export { ClientEventMap, PacketSentEvent, PacketReceivedEvent, RawPacketReceivedEvent, RawPacketSentEvent, ConnectEvent, DisconnectEvent, HeartbeatEvent, HeartbeatFailedEvent, PrinterInfoFetchedEvent } from "./events";

// WeChat-specific client and types
export { NiimbotWechatBleClient, WechatBleDefaultConfiguration } from "./client/wechat_ble_impl";
export {
  NiimbotWechatBleClientConnectOptions,
  WechatBleDevice,
  WechatBleService,
  WechatBleCharacteristic,
  WechatDiscoveryFilters,
  WechatWx,
} from "./client/wechat_types";

// Print tasks (safe for WeChat)
export { AbstractPrintTask, PrintTaskName, findPrintTask } from "./print_tasks";
export { B1PrintTask } from "./print_tasks/B1PrintTask";
export { B21V1PrintTask } from "./print_tasks/B21V1PrintTask";
export { D110PrintTask } from "./print_tasks/D110PrintTask";
export { D110MV4PrintTask } from "./print_tasks/D110MV4PrintTask";
export { OldD11PrintTask } from "./print_tasks/OldD11PrintTask";

// Image encoder (safe for WeChat)
export { ImageEncoder, ImageRow, EncodedImage, PrintDirection } from "./image_encoder";

// Utils (safe for WeChat)
export { Utils, Validators } from "./utils";

// Printer models (safe for WeChat)
export { modelsLibrary, PrinterModelMeta, getPrinterMetaById, getPrinterMetaByModel } from "./printer_models";