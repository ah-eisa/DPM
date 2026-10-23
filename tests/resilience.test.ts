import { describe, expect, it } from "vitest";
import { BACKUP_RETENTION, BackupSnapshot, decryptState, encryptState, retentionVictims } from "../lib/resilience";
import { seedState } from "../lib/storage";

describe("encrypted resilience backups",()=>{
  it("round-trips a validated book with an explicit recovery key",async()=>{
    const key=new Uint8Array(32);key.fill(7);
    const encrypted=await encryptState(seedState,key);
    expect(encrypted.type).toBe("dpm-desk-encrypted-backup");
    expect(encrypted.ciphertext).not.toContain("Balanced Mandate");
    const restored=await decryptState(encrypted,key);
    expect(restored).toEqual(seedState);
  });
  it("rejects the wrong recovery key",async()=>{
    const one=new Uint8Array(32);one.fill(1);const two=new Uint8Array(32);two.fill(2);
    const encrypted=await encryptState(seedState,one);
    await expect(decryptState(encrypted,two)).rejects.toThrow(/recovery key/i);
  });
  it("retains the newest thirty snapshots and selects the oldest for deletion",()=>{
    const snapshots=Array.from({length:BACKUP_RETENTION+2},(_,i)=>({id:String(i),createdAt:new Date(Date.UTC(2026,0,i+1)).toISOString(),envelope:{} as BackupSnapshot["envelope"]}));
    expect(retentionVictims(snapshots).map(x=>x.id)).toEqual(["1","0"]);
  });
});
