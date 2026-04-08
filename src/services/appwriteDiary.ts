import {
  Account,
  AppwriteException,
  Client,
  Databases,
  ID,
  OAuthProvider,
  Permission,
  Query,
  Role,
  type Models,
} from 'react-native-appwrite';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

WebBrowser.maybeCompleteAuthSession();

export type DiaryEntry = {
  id: string;
  text: string;
  createdAt: number;
};

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  isAnonymous: boolean;
};

type AppwriteDiaryDocument = Models.Document & {
  text?: unknown;
  createdAt?: unknown;
  ownerId?: unknown;
};

const endpoint = process.env.EXPO_PUBLIC_APPWRITE_ENDPOINT;
const projectId = process.env.EXPO_PUBLIC_APPWRITE_PROJECT_ID;
const databaseId = process.env.EXPO_PUBLIC_APPWRITE_DATABASE_ID;
const collectionId = process.env.EXPO_PUBLIC_APPWRITE_COLLECTION_ID;

export const appwriteConfigError =
  endpoint && projectId && databaseId && collectionId
    ? null
    : 'Missing Appwrite config. Add EXPO_PUBLIC_APPWRITE_ENDPOINT, EXPO_PUBLIC_APPWRITE_PROJECT_ID, EXPO_PUBLIC_APPWRITE_DATABASE_ID, and EXPO_PUBLIC_APPWRITE_COLLECTION_ID to .env.';

const client = new Client();

if (endpoint && projectId) {
  client.setEndpoint(endpoint).setProject(projectId);
}

const account = new Account(client);
const databases = new Databases(client);
let cachedUserId: string | null = null;

const AUTH_USER_STORAGE_KEY = 'dairy.auth.user.v1';
const OAUTH_PENDING_STORAGE_KEY = 'dairy.auth.oauth.pending.v1';

const OAUTH_SCOPES = ['profile', 'email'];

type WebStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const getWebStorage = (): WebStorage | null => {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return null;
  }

  return window.localStorage;
};

const readStorageValue = (key: string): string | null => {
  const storage = getWebStorage();
  if (!storage) {
    return null;
  }

  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
};

const writeStorageValue = (key: string, value: string): void => {
  const storage = getWebStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(key, value);
  } catch {
    // Ignore storage write failures and continue with in-memory auth state.
  }
};

const removeStorageValue = (key: string): void => {
  const storage = getWebStorage();
  if (!storage) {
    return;
  }

  try {
    storage.removeItem(key);
  } catch {
    // Ignore storage remove failures and continue with in-memory auth state.
  }
};

const setOAuthPending = (isPending: boolean): void => {
  if (isPending) {
    writeStorageValue(OAUTH_PENDING_STORAGE_KEY, '1');
    return;
  }

  removeStorageValue(OAUTH_PENDING_STORAGE_KEY);
};

const clearStoredAuthUser = (): void => {
  removeStorageValue(AUTH_USER_STORAGE_KEY);
};

const saveStoredAuthUser = (user: AuthUser): void => {
  writeStorageValue(AUTH_USER_STORAGE_KEY, JSON.stringify(user));
};

const parseStoredAuthUser = (value: string | null): AuthUser | null => {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof parsed.id !== 'string' ||
      typeof parsed.name !== 'string' ||
      typeof parsed.email !== 'string' ||
      typeof parsed.isAnonymous !== 'boolean'
    ) {
      return null;
    }

    return {
      id: parsed.id,
      name: parsed.name,
      email: parsed.email,
      isAnonymous: parsed.isAnonymous,
    };
  } catch {
    return null;
  }
};

export const getCachedAuthUser = (): AuthUser | null =>
  parseStoredAuthUser(readStorageValue(AUTH_USER_STORAGE_KEY));

const clearOAuthCallbackParamsFromUrl = (): void => {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return;
  }

  try {
    const currentUrl = new URL(window.location.href);
    const hasOAuthParams =
      currentUrl.searchParams.has('userId') || currentUrl.searchParams.has('secret');

    if (!hasOAuthParams) {
      return;
    }

    currentUrl.searchParams.delete('userId');
    currentUrl.searchParams.delete('secret');
    window.history.replaceState({}, '', `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`);
  } catch {
    // Keep current URL if we cannot safely rewrite it.
  }
};

const getOAuthRedirectUrl = (): string => Linking.createURL('/auth/callback');

const toAuthUser = (user: Models.User<Models.Preferences>): AuthUser => {
  const hasEmail = typeof user.email === 'string' && user.email.length > 0;
  const hasName = typeof user.name === 'string' && user.name.length > 0;

  return {
    id: user.$id,
    name: hasName ? user.name : hasEmail ? user.email : 'Guest',
    email: hasEmail ? user.email : '',
    isAnonymous: !hasEmail,
  };
};

const parseCreatedAt = (createdAt: unknown, fallback: string): number => {
  const source = typeof createdAt === 'string' ? createdAt : fallback;
  return Date.parse(source);
};

const toDiaryEntry = (document: AppwriteDiaryDocument): DiaryEntry | null => {
  if (typeof document.$id !== 'string' || typeof document.text !== 'string') {
    return null;
  }

  const createdAtTimestamp = parseCreatedAt(document.createdAt, document.$createdAt);
  if (!Number.isFinite(createdAtTimestamp)) {
    return null;
  }

  return {
    id: document.$id,
    text: document.text,
    createdAt: createdAtTimestamp,
  };
};

const readSessionTokenFromCallbackIfPresent = (
  callbackUrl: string
): { userId: string; secret: string } | null => {
  const parsed = Linking.parse(callbackUrl);
  const userIdValue = parsed.queryParams?.userId;
  const secretValue = parsed.queryParams?.secret;

  const userId = typeof userIdValue === 'string' ? userIdValue : '';
  const secret = typeof secretValue === 'string' ? secretValue : '';

  if (!userId || !secret) {
    return null;
  }

  return { userId, secret };
};

const restoreWebOAuthSessionIfPresent = async (): Promise<void> => {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return;
  }

  const token = readSessionTokenFromCallbackIfPresent(window.location.href);
  if (!token) {
    return;
  }
  // If a session is already active, attempt to detect whether it's anonymous.
  // If the active session is anonymous, delete it and then create the OAuth session.
  try {
    const existing = await account.get();
    const hasEmail = typeof existing.email === 'string' && existing.email.length > 0;
    if (hasEmail) {
      // Already signed in with a non-anonymous account; nothing to do.
      // eslint-disable-next-line no-console
      console.debug('restoreWebOAuthSessionIfPresent: non-anon session active, skipping createSession');
      setOAuthPending(false);
      clearOAuthCallbackParamsFromUrl();
      return;
    }

    // Active session is anonymous; attempt to delete it so we can create the OAuth session.
    try {
      // eslint-disable-next-line no-console
      console.debug('restoreWebOAuthSessionIfPresent: anonymous session active — deleting current session to upgrade to OAuth');
      await account.deleteSession('current');
    } catch (delErr) {
      // eslint-disable-next-line no-console
      console.warn('Failed to delete existing anonymous session; will still attempt to create OAuth session', delErr);
    }
  } catch (error) {
    // If the error is not an auth error, rethrow. Otherwise no session is active and we'll create one.
    if (!(error instanceof AppwriteException) || (error.code !== 401 && error.code !== 403)) {
      throw error;
    }
  }

  try {
    // Attempt to create the session using the token returned from Appwrite OAuth.
    // If this fails we log the error and clear the pending flag so the app can recover.
    // eslint-disable-next-line no-console
    console.debug('restoreWebOAuthSessionIfPresent: creating session', { userId: token.userId });
    await account.createSession(token.userId, token.secret);
    setOAuthPending(false);
    clearOAuthCallbackParamsFromUrl();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Appwrite createSession failed during OAuth restore:', error);
    setOAuthPending(false);
    // don't rethrow so callers can fall back to anonymous session
  }
};

const ensureSignedInUser = async (): Promise<string> => {
  if (appwriteConfigError) {
    throw new Error(appwriteConfigError);
  }

  await restoreWebOAuthSessionIfPresent();

  if (cachedUserId) {
    return cachedUserId;
  }

  try {
    const currentUser = await account.get();
    cachedUserId = currentUser.$id;
    return currentUser.$id;
  } catch (error) {
    if (!(error instanceof AppwriteException) || (error.code !== 401 && error.code !== 403)) {
      throw error;
    }

    await account.createAnonymousSession();
    setOAuthPending(false);
    const anonymousUser = await account.get();
    cachedUserId = anonymousUser.$id;
    saveStoredAuthUser(toAuthUser(anonymousUser));
    return anonymousUser.$id;
  }
};

export async function getCurrentUser(): Promise<AuthUser | null> {
  if (appwriteConfigError) {
    throw new Error(appwriteConfigError);
  }

  await restoreWebOAuthSessionIfPresent();

  try {
    const currentUser = await account.get();
    const authUser = toAuthUser(currentUser);
    cachedUserId = currentUser.$id;
    saveStoredAuthUser(authUser);
    return authUser;
  } catch (error) {
    if (error instanceof AppwriteException && (error.code === 401 || error.code === 403)) {
      cachedUserId = null;
      clearStoredAuthUser();
      return null;
    }

    throw error;
  }
}

export async function signInAnonymously(): Promise<AuthUser> {
  if (appwriteConfigError) {
    throw new Error(appwriteConfigError);
  }

  await restoreWebOAuthSessionIfPresent();

  try {
    const currentUser = await account.get();
    const authUser = toAuthUser(currentUser);
    cachedUserId = currentUser.$id;
    saveStoredAuthUser(authUser);
    return authUser;
  } catch (error) {
    if (error instanceof AppwriteException && error.code !== 401 && error.code !== 403) {
      throw error;
    }

    await account.createAnonymousSession();
    const anonymousUser = await account.get();
    const authUser = toAuthUser(anonymousUser);
    cachedUserId = anonymousUser.$id;
    setOAuthPending(false);
    saveStoredAuthUser(authUser);
    return authUser;
  }
}

const readSessionTokenFromCallback = (
  callbackUrl: string
): { userId: string; secret: string } => {
  const token = readSessionTokenFromCallbackIfPresent(callbackUrl);
  if (!token) {
    throw new Error('Google sign-in did not return a valid token.');
  }

  return token;
};

const toUrlString = (value: void | URL): string => {
  if (typeof value === 'string') {
    return value;
  }

  if (value instanceof URL) {
    return value.toString();
  }

  throw new Error('Could not start Google sign-in. Please try again.');
};

export async function signInWithGoogle(): Promise<AuthUser> {
  if (appwriteConfigError) {
    throw new Error(appwriteConfigError);
  }

  const redirectUrl = getOAuthRedirectUrl();
  setOAuthPending(true);

  if (Platform.OS === 'web') {
    const webTokenUrl = toUrlString(
      account.createOAuth2Token(
        OAuthProvider.Google,
        redirectUrl,
        redirectUrl,
        OAUTH_SCOPES
      )
    );

    window.location.assign(webTokenUrl);

    throw new Error('Redirecting to Google sign-in...');
  }

  const authUrl = toUrlString(
    account.createOAuth2Token(
      OAuthProvider.Google,
      redirectUrl,
      redirectUrl,
      OAUTH_SCOPES
    )
  );

  const authResult = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
  if (authResult.type !== 'success' || !authResult.url) {
    setOAuthPending(false);
    throw new Error('Google sign-in was canceled or did not finish.');
  }

  const { userId, secret } = readSessionTokenFromCallback(authResult.url);
  await account.createSession(userId, secret);
  setOAuthPending(false);

  const signedInUser = await getCurrentUser();
  if (!signedInUser) {
    clearStoredAuthUser();
    throw new Error('Google sign-in finished but no session was found.');
  }

  return signedInUser;
}

export async function signOutCurrentUser(): Promise<void> {
  if (appwriteConfigError) {
    throw new Error(appwriteConfigError);
  }

  await account.deleteSession('current');
  cachedUserId = null;
  setOAuthPending(false);
  clearStoredAuthUser();
}

export async function fetchDiaryEntries(): Promise<DiaryEntry[]> {
  if (appwriteConfigError) {
    throw new Error(appwriteConfigError);
  }

  const userId = await ensureSignedInUser();
  const response = await databases.listDocuments<AppwriteDiaryDocument>(
    databaseId!,
    collectionId!,
    [
      Query.equal('ownerId', userId),
      Query.orderDesc('createdAt'),
      Query.limit(200),
    ]
  );

  return response.documents
    .map(toDiaryEntry)
    .filter((entry): entry is DiaryEntry => entry !== null)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function createDiaryEntry(text: string): Promise<DiaryEntry> {
  if (appwriteConfigError) {
    throw new Error(appwriteConfigError);
  }

  const trimmedText = text.trim();
  if (!trimmedText) {
    throw new Error('Diary entry cannot be empty.');
  }

  const userId = await ensureSignedInUser();
  const createdDocument = await databases.createDocument<AppwriteDiaryDocument>(
    databaseId!,
    collectionId!,
    ID.unique(),
    {
      text: trimmedText,
      createdAt: new Date().toISOString(),
      ownerId: userId,
    },
    [
      Permission.read(Role.user(userId)),
      Permission.update(Role.user(userId)),
      Permission.delete(Role.user(userId)),
    ]
  );

  const createdEntry = toDiaryEntry(createdDocument);
  if (!createdEntry) {
    throw new Error('Appwrite returned invalid diary data.');
  }

  return createdEntry;
}

export function getDiaryErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const normalizedMessage = error.message.toLowerCase();

    if (normalizedMessage.includes('redirecting to google sign-in')) {
      return 'Opening Google sign-in...';
    }

    if (normalizedMessage.includes('missing appwrite config')) {
      return 'Appwrite is not configured yet. Add the required keys in your .env file.';
    }

    if (
      normalizedMessage.includes('network') ||
      normalizedMessage.includes('timeout') ||
      normalizedMessage.includes('fetch')
    ) {
      return 'Could not connect to Appwrite. Check your internet connection and try again.';
    }

    if (
      normalizedMessage.includes('unauthorized') ||
      normalizedMessage.includes('forbidden') ||
      normalizedMessage.includes('401') ||
      normalizedMessage.includes('403')
    ) {
      return 'Appwrite denied access to this diary action.';
    }

    if (
      normalizedMessage.includes('rate limit') ||
      normalizedMessage.includes('429')
    ) {
      return 'Too many requests right now. Please wait a moment and try again.';
    }
  }

  return 'Something went wrong while syncing your diary.';
}
