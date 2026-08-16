/** Protocol type definitions for the ilink gateway */

export interface IlinkMedia {
  encrypt_query_param?: string;
  aes_key?: string;
  encrypt_type?: number;
}

export interface IlinkMsgItem {
  type?: number;
  text_item?: { text?: string };
  voice_item?: { media?: IlinkMedia; text?: string; encode_type?: number };
  image_item?: { media?: IlinkMedia; thumb_media?: IlinkMedia; aeskey?: string; mid_size?: number };
  file_item?: { media?: IlinkMedia; file_name?: string; len?: string };
  video_item?: { media?: IlinkMedia; thumb_media?: IlinkMedia; video_size?: number };
  ref_msg?: { message_item?: IlinkMsgItem; title?: string };
}

export interface IlinkMessage {
  seq?: number;
  message_id?: number;
  from_user_id?: string;
  to_user_id?: string;
  client_id?: string;
  create_time_ms?: number;
  session_id?: string;
  message_type?: number;
  message_state?: number;
  item_list?: IlinkMsgItem[];
  context_token?: string;
}

export interface GetUpdatesResult {
  ret: number;
  errcode: number;
  errmsg: string;
  msgs?: IlinkMessage[];
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
}

export interface QrCodeResult {
  qrcode: string;
  qrcode_img_content: string;
}

export interface QrStatusResult {
  status: string; // wait | scaned | expired | confirmed
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  ilink_user_id?: string;
}

export interface InboundAttachment {
  kind: 'image' | 'file' | 'video' | 'audio';
  name: string;
  mime: string;
  data: Uint8Array;
}

export interface InboundMessage {
  from: string;
  messageId: string;
  timeMs: number;
  text: string;
  attachments: InboundAttachment[];
  raw: IlinkMessage;
}

/** Protocol constants */
export const MSG_TYPE_USER = 1;
export const MSG_TYPE_BOT = 2;
export const ITEM_TEXT = 1;
export const ITEM_IMAGE = 2;
export const ITEM_VOICE = 3;
export const ITEM_FILE = 4;
export const ITEM_VIDEO = 5;
export const MSG_STATE_FINISH = 2;
export const ERRCODE_SESSION_EXPIRED = -14;

/** getuploadurl media types */
export const UPLOAD_MEDIA_IMAGE = 1;
export const UPLOAD_MEDIA_VIDEO = 2;
export const UPLOAD_MEDIA_FILE = 3;

export interface GetUploadUrlResult {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  upload_param?: string;
  thumb_upload_param?: string;
  /** Newer gateway versions return the full CDN upload URL directly */
  upload_full_url?: string;
}

/** A file picked up from the outbox, ready to send */
export interface OutboundAttachment {
  kind: 'image' | 'file' | 'video';
  name: string;
  data: Uint8Array;
}
