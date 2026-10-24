import { DpmState } from "./types";
import { validateState } from "./validation";

const DB_NAME = "dpm-desk-resilience-v1";
const SNAPSHOT_STORE = "snapshots";
const SETTINGS_STORE = "settings";
export const BACKUP_RETENTION = 30;
const KEY_SETTING = "device-backup-key";
const FOLDER_SETTING = "backup-folder";

export type BackupSnapshot = { id: string; createdAt: string; envelope: EncryptedBackupEnvelope };
export type EncryptedBackupEnvelope = { type: "dpm-desk-encrypted-backup"; version: 1; algorithm: "AES-GCM"; keyId?: string; iv: string; ciphertext: string; createdAt: string };

type PickerWindow = Window & { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> };
type PermissionHandle = FileSystemHandle & { queryPermission?: (options?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>; requestPermission?: (options?: { mode?: "read" | "readwrite" }) => Promise<PermissionState> };

function requireBrowser() { if (typeof window === "undefined" || typeof indexedDB === "undefined") throw new Error("Backup storage is only available in the browser"); }
function bytesToBase64(bytes: Uint8Array) { let out = ""; for (const b of bytes) out += String.fromCharCode(b); return btoa(out); }
function base64ToBytes(value: string) { const raw = atob(value); const out = new Uint8Array(raw.length); for (let i=0;i<raw.length;i++) out[i]=raw.charCodeAt(i); return out; }
function asArrayBuffer(bytes:Uint8Array):ArrayBuffer{const copy=new Uint8Array(bytes.byteLength);copy.set(bytes);return copy.buffer;}

function openDb(): Promise<IDBDatabase> {
  requireBrowser();
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,1);
    request.onupgradeneeded=()=>{ const db=request.result; if(!db.objectStoreNames.contains(SNAPSHOT_STORE)) db.createObjectStore(SNAPSHOT_STORE,{keyPath:"id"}); if(!db.objectStoreNames.contains(SETTINGS_STORE)) db.createObjectStore(SETTINGS_STORE); };
    request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error ?? new Error("Could not open backup storage"));
  });
}

async function storeGet<T>(store:string,key:IDBValidKey):Promise<T|undefined>{const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(store,"readonly"),r=tx.objectStore(store).get(key);r.onsuccess=()=>resolve(r.result as T|undefined);r.onerror=()=>reject(r.error);tx.oncomplete=()=>db.close();});}
async function storePut(store:string,value:unknown,key?:IDBValidKey){const db=await openDb();return new Promise<void>((resolve,reject)=>{const tx=db.transaction(store,"readwrite");key===undefined?tx.objectStore(store).put(value):tx.objectStore(store).put(value,key);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(tx.error);};});}
async function storeDelete(store:string,key:IDBValidKey){const db=await openDb();return new Promise<void>((resolve,reject)=>{const tx=db.transaction(store,"readwrite");tx.objectStore(store).delete(key);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(tx.error);};});}
async function storeAll<T>(store:string):Promise<T[]>{const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(store,"readonly"),r=tx.objectStore(store).getAll();r.onsuccess=()=>resolve(r.result as T[]);r.onerror=()=>reject(r.error);tx.oncomplete=()=>db.close();});}

let keyCreationInFlight:Promise<Uint8Array>|undefined;
async function createOrReadRawKey():Promise<Uint8Array>{
  const db=await openDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(SETTINGS_STORE,"readwrite"),store=tx.objectStore(SETTINGS_STORE),request=store.get(KEY_SETTING);
    let selected:Uint8Array|undefined;
    request.onsuccess=()=>{
      if(typeof request.result==="string"){selected=base64ToBytes(request.result);return;}
      selected=crypto.getRandomValues(new Uint8Array(32));
      store.add(bytesToBase64(selected),KEY_SETTING);
    };
    request.onerror=()=>{try{tx.abort();}catch{} reject(request.error??new Error("Could not read backup recovery key"));};
    tx.oncomplete=()=>{db.close();selected?resolve(selected):reject(new Error("Could not create backup recovery key"));};
    tx.onerror=()=>{db.close();reject(tx.error??new Error("Could not create backup recovery key"));};
    tx.onabort=()=>{db.close();reject(tx.error??new Error("Could not create backup recovery key"));};
  });
}
async function ensureRawKey():Promise<Uint8Array>{
  keyCreationInFlight??=createOrReadRawKey().finally(()=>{keyCreationInFlight=undefined;});
  return keyCreationInFlight;
}
async function cryptoKey(raw:Uint8Array){return crypto.subtle.importKey("raw",asArrayBuffer(raw),{name:"AES-GCM"},false,["encrypt","decrypt"]);}
async function keyId(raw:Uint8Array){return bytesToBase64(new Uint8Array(await crypto.subtle.digest("SHA-256",asArrayBuffer(raw)))).replace(/[^a-zA-Z0-9]/g,"");}
type RetainedKey = { type:"retained-recovery-key"; id:string; key:string };

export async function encryptState(state:DpmState,rawKey?:Uint8Array):Promise<EncryptedBackupEnvelope>{
  const valid=validateState(state),raw=rawKey??await ensureRawKey(),iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=await crypto.subtle.encrypt({name:"AES-GCM",iv},await cryptoKey(raw),new TextEncoder().encode(JSON.stringify(valid)));
  return {type:"dpm-desk-encrypted-backup",version:1,algorithm:"AES-GCM",keyId:await keyId(raw),iv:bytesToBase64(iv),ciphertext:bytesToBase64(new Uint8Array(encrypted)),createdAt:new Date().toISOString()};
}
export async function decryptState(envelope:EncryptedBackupEnvelope,rawKey?:Uint8Array):Promise<DpmState>{
  if(envelope?.type!=="dpm-desk-encrypted-backup"||envelope.version!==1||envelope.algorithm!=="AES-GCM")throw new Error("Unsupported encrypted backup");
  const keys:Uint8Array[]=[];
  if(rawKey) keys.push(rawKey);
  else {
    keys.push(await ensureRawKey());
    if(envelope.keyId){const retained=await storeGet<RetainedKey>(SETTINGS_STORE,`recovery-key:${envelope.keyId}`);if(retained)keys.push(base64ToBytes(retained.key));}
    else for(const value of await storeAll<unknown>(SETTINGS_STORE)){const entry=value as RetainedKey;if(entry?.type==="retained-recovery-key")keys.push(base64ToBytes(entry.key));}
  }
  for(const raw of keys){try{const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:base64ToBytes(envelope.iv)},await cryptoKey(raw),base64ToBytes(envelope.ciphertext));return validateState(JSON.parse(new TextDecoder().decode(plain)));}catch{/* Try the remaining retained keys. */}}
  throw new Error("Encrypted backup could not be decrypted with this recovery key");
}

export function retentionVictims(snapshots:BackupSnapshot[]){return snapshots.slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(BACKUP_RETENTION);}
async function storeSnapshotEnvelope(envelope:EncryptedBackupEnvelope){const snapshot:BackupSnapshot={id:`${Date.now()}-${crypto.getRandomValues(new Uint32Array(1))[0]}`,createdAt:envelope.createdAt,envelope};await storePut(SNAPSHOT_STORE,snapshot);const all=await storeAll<BackupSnapshot>(SNAPSHOT_STORE);for(const old of retentionVictims(all))await storeDelete(SNAPSHOT_STORE,old.id);return snapshot;}
export async function createSnapshot(state:DpmState){return storeSnapshotEnvelope(await encryptState(state));}
export async function listSnapshots(){return (await storeAll<BackupSnapshot>(SNAPSHOT_STORE)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
export async function restoreSnapshot(id:string){const snapshot=await storeGet<BackupSnapshot>(SNAPSHOT_STORE,id);if(!snapshot)throw new Error("Snapshot not found");return decryptState(snapshot.envelope);}
export async function deleteSnapshot(id:string){await storeDelete(SNAPSHOT_STORE,id);}

function downloadText(name:string,text:string,type="application/json"){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement("a");a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);}
export async function downloadRecoveryKey(){const raw=await ensureRawKey();downloadText("dpm-desk-recovery-key.json",JSON.stringify({type:"dpm-desk-recovery-key",version:1,key:bytesToBase64(raw)},null,2));}
export async function importRecoveryKey(file:File){if(file.size>65536)throw new Error("Recovery key file exceeds 64 KB");let parsed:{type?:string;version?:number;key?:string};try{parsed=JSON.parse(await file.text()) as typeof parsed;}catch{throw new Error("Recovery key file is not valid JSON");}if(parsed.type!=="dpm-desk-recovery-key"||parsed.version!==1||!parsed.key)throw new Error("Invalid recovery key file");const raw=base64ToBytes(parsed.key);if(raw.length!==32)throw new Error("Invalid recovery key length");const id=await keyId(raw);await storePut(SETTINGS_STORE,{type:"retained-recovery-key",id,key:parsed.key} satisfies RetainedKey,`recovery-key:${id}`);}
export async function downloadEncryptedBackup(state:DpmState){const envelope=await encryptState(state);downloadText(`dpm-desk-${new Date().toISOString().replace(/[:.]/g,"-")}.dpmx`,JSON.stringify(envelope,null,2),"application/octet-stream");}
export async function importEncryptedBackup(file:File){if(file.size>10*1024*1024)throw new Error("Encrypted backup exceeds 10 MB");let envelope:EncryptedBackupEnvelope;try{envelope=JSON.parse(await file.text()) as EncryptedBackupEnvelope;}catch{throw new Error("Encrypted backup file is not valid JSON");}return decryptState(envelope);}

async function permission(handle:PermissionHandle,request=false){const options={mode:"readwrite" as const};const current=handle.queryPermission?await handle.queryPermission(options):"granted";if(current==="granted")return true;if(request&&handle.requestPermission)return await handle.requestPermission(options)==="granted";return false;}
export async function connectBackupFolder(){const picker=(window as PickerWindow).showDirectoryPicker;if(!picker)throw new Error("Folder auto-backup requires a Chromium browser with File System Access support");const handle=await picker();if(!await permission(handle,true))throw new Error("Backup folder permission was not granted");await storePut(SETTINGS_STORE,handle,FOLDER_SETTING);return handle.name;}
export async function disconnectBackupFolder(){await storeDelete(SETTINGS_STORE,FOLDER_SETTING);}
export async function connectedFolderName(){const handle=await storeGet<FileSystemDirectoryHandle>(SETTINGS_STORE,FOLDER_SETTING);return handle?.name;}

async function writeFolderBackup(envelope:EncryptedBackupEnvelope){
  const handle=await storeGet<FileSystemDirectoryHandle>(SETTINGS_STORE,FOLDER_SETTING);if(!handle||!await permission(handle))return false;
  const name=`dpm-backup-${envelope.createdAt.replace(/[:.]/g,"-")}.dpmx`,file=await handle.getFileHandle(name,{create:true}),writer=await file.createWritable();await writer.write(JSON.stringify(envelope));await writer.close();
  const entries:string[]=[];for await(const [entryName] of (handle as FileSystemDirectoryHandle & {entries():AsyncIterableIterator<[string,FileSystemHandle]>}).entries())if(entryName.startsWith("dpm-backup-")&&entryName.endsWith(".dpmx"))entries.push(entryName);entries.sort().reverse();for(const old of entries.slice(BACKUP_RETENTION))await handle.removeEntry(old);return true;
}
export async function backupNow(state:DpmState){const envelope=await encryptState(state);const snapshot=await storeSnapshotEnvelope(envelope);const external=await writeFolderBackup(envelope);return {snapshot,external};}
export function queueResilienceBackup(state:DpmState){if(typeof window==="undefined")return;queueMicrotask(()=>{void backupNow(state).catch(()=>{/* Primary save must not fail because secondary backup failed. */});});}
export async function backupStatus(){const snapshots=await listSnapshots(),folder=await connectedFolderName();return {snapshotCount:snapshots.length,latest:snapshots[0]?.createdAt,folder};}
