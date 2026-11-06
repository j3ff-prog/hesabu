import type { Api } from './cloudApi'
import { realApi } from './cloudReal'
import { fakeApi } from './cloudFake'

/** Tests build the app with VITE_FAKE_CLOUD set, so it talks to a small stand-in server instead of Supabase. */
export const api: Api = import.meta.env.VITE_FAKE_CLOUD ? fakeApi : realApi
