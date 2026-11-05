// One short, fixed sample per clone. Preview generation is a platform expense;
// never admit it through the customer usage/wallet or live-call paths.
export const customVoicePreviewText = "Hi, this is a preview of my AI voice. I'm calling about your property. Is now a good time to talk?";
export const customVoicePreviewRequest = {
 text: customVoicePreviewText,
 model_id: 'eleven_v4_turbo',
 voice_settings: {stability: 0.5, similarity_boost: 0.75},
};
export const maxCustomVoicePreviewBytes = 500_000;
export type CustomVoicePreview = {
 id: string; account_id: string; custom_voice_id: string; voice_id: string;
 attempt: number; state: 'generating'|'ready'|'rejected'|'unknown';
 request: typeof customVoicePreviewRequest; audio_base64: string|null;
 history_item_id: string|null; request_id: string|null;
 created_at: string; updated_at: string;
};
export function previewAudioValid(bytes: Uint8Array) {
 return bytes.length >= 1000 && bytes.length <= maxCustomVoicePreviewBytes &&
  (Buffer.from(bytes.subarray(0,3)).toString() === 'ID3' || bytes[0] === 255 && (bytes[1] & 0xe0) === 0xe0);
}
