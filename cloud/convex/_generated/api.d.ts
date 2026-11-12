/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accounts from "../accounts.js";
import type * as admin from "../admin.js";
import type * as apps from "../apps.js";
import type * as auth from "../auth.js";
import type * as billing from "../billing.js";
import type * as boxes from "../boxes.js";
import type * as chat from "../chat.js";
import type * as config from "../config.js";
import type * as crons from "../crons.js";
import type * as estimates from "../estimates.js";
import type * as github from "../github.js";
import type * as http from "../http.js";
import type * as lib_credits from "../lib/credits.js";
import type * as lib_crypto from "../lib/crypto.js";
import type * as lib_instabox from "../lib/instabox.js";
import type * as lib_keyservice from "../lib/keyservice.js";
import type * as lib_pcLinkPage from "../lib/pcLinkPage.js";
import type * as lib_provider from "../lib/provider.js";
import type * as lib_session from "../lib/session.js";
import type * as lib_transport from "../lib/transport.js";
import type * as pages from "../pages.js";
import type * as pclinks from "../pclinks.js";
import type * as runner from "../runner.js";
import type * as signing from "../signing.js";
import type * as stripe from "../stripe.js";
import type * as todos from "../todos.js";
import type * as webhooks from "../webhooks.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accounts: typeof accounts;
  admin: typeof admin;
  apps: typeof apps;
  auth: typeof auth;
  billing: typeof billing;
  boxes: typeof boxes;
  chat: typeof chat;
  config: typeof config;
  crons: typeof crons;
  estimates: typeof estimates;
  github: typeof github;
  http: typeof http;
  "lib/credits": typeof lib_credits;
  "lib/crypto": typeof lib_crypto;
  "lib/instabox": typeof lib_instabox;
  "lib/keyservice": typeof lib_keyservice;
  "lib/pcLinkPage": typeof lib_pcLinkPage;
  "lib/provider": typeof lib_provider;
  "lib/session": typeof lib_session;
  "lib/transport": typeof lib_transport;
  pages: typeof pages;
  pclinks: typeof pclinks;
  runner: typeof runner;
  signing: typeof signing;
  stripe: typeof stripe;
  todos: typeof todos;
  webhooks: typeof webhooks;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
