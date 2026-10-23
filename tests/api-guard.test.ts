import { beforeEach, describe, expect, it } from "vitest";
import { guardMarketApi, MARKET_API_COOKIE, marketApiSessionValue, resetApiGuardForTests } from "../lib/api-guard";

const req=(headers:Record<string,string>)=>new Request("https://dpm.test/api/quotes",{headers});

describe("market API guard",()=>{
  beforeEach(()=>resetApiGuardForTests());
  it("accepts a valid bearer token",()=>{expect(guardMarketApi(req({authorization:"Bearer secret","x-forwarded-for":"1.2.3.4"}),"quotes",120,{token:"secret",production:true})).toEqual({ok:true});});
  it("accepts the derived HttpOnly session cookie",()=>{const session=marketApiSessionValue("secret");expect(guardMarketApi(req({cookie:`${MARKET_API_COOKIE}=${session}`,"x-forwarded-for":"1.2.3.4"}),"quotes",120,{token:"secret",production:true})).toEqual({ok:true});});
  it("rejects missing credentials in production",()=>{expect(guardMarketApi(req({"x-forwarded-for":"1.2.3.4"}),"quotes",120,{token:"secret",production:true})).toMatchObject({ok:false,status:401});});
  it("fails closed when production has no configured token",()=>{expect(guardMarketApi(req({"x-forwarded-for":"1.2.3.4"}),"quotes",120,{token:"",production:true})).toMatchObject({ok:false,status:503});});
  it("rate limits an authenticated client per scope",()=>{const request=req({authorization:"Bearer secret","x-forwarded-for":"9.9.9.9"});expect(guardMarketApi(request,"history",1,{token:"secret",production:true,now:1000})).toEqual({ok:true});expect(guardMarketApi(request,"history",1,{token:"secret",production:true,now:1001})).toMatchObject({ok:false,status:429});});
});
