import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { decryptState, encryptState, importRecoveryKey } from "../lib/resilience";
import { seedState } from "../lib/storage";
beforeEach(()=>{vi.stubGlobal("window",{});vi.stubGlobal("indexedDB",new IDBFactory());});
afterEach(()=>vi.unstubAllGlobals());
it("retains the active device key after importing a different recovery key",async()=>{
  const original=await encryptState(seedState);
  const imported=new Uint8Array(32).fill(7);
  const other=await encryptState(seedState,imported);
  const legacy={...other};delete legacy.keyId;
  const file=new File([JSON.stringify({type:"dpm-desk-recovery-key",version:1,key:btoa(String.fromCharCode(...imported))})],"key.json");
  await importRecoveryKey(file);
  expect(await decryptState(original)).toMatchObject({version:4,clients:seedState.clients});
  expect(await decryptState(other)).toMatchObject({version:4,clients:seedState.clients});
  expect(await decryptState(legacy)).toMatchObject({version:4,clients:seedState.clients});
  const next=await encryptState(seedState);expect(next.keyId).toBe(original.keyId);
});
it("creates the same device key across independent module instances",async()=>{
  vi.resetModules();const a=await import("../lib/resilience");vi.resetModules();const b=await import("../lib/resilience");
  const [one,two]=await Promise.all([a.encryptState(seedState),b.encryptState(seedState)]);
  expect(one.keyId).toBe(two.keyId);expect(await a.decryptState(two)).toMatchObject({version:4,clients:seedState.clients});expect(await b.decryptState(one)).toMatchObject({version:4,clients:seedState.clients});
});
