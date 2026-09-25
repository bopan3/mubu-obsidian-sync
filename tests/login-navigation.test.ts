import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedLoginNavigation, safeUrlForLog } from "../src/login-navigation";

test("allows Mubu and known OAuth hosts only", () => {
  assert.equal(isAllowedLoginNavigation("https://mubu.com/login"), true);
  assert.equal(isAllowedLoginNavigation("https://api2.mubu.com/auth"), true);
  assert.equal(isAllowedLoginNavigation("https://open.weixin.qq.com/connect"), true);
  assert.equal(isAllowedLoginNavigation("https://accounts.google.com/o/oauth2"), true);
  assert.equal(isAllowedLoginNavigation("https://mubu.com.example.com/login"), false);
  assert.equal(isAllowedLoginNavigation("http://mubu.com/login"), false);
  assert.equal(isAllowedLoginNavigation("javascript:alert(1)"), false);
});

test("redacts query and fragment from login navigation logs", () => {
  assert.equal(safeUrlForLog("https://mubu.com/callback?code=secret#token"), "https://mubu.com/callback");
});
