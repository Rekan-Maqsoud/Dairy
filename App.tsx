import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Alert,
} from 'react-native';
import {
  appwriteConfigError,
  createDiaryEntry,
  fetchDiaryEntries,
  getDiaryErrorMessage,
  getCurrentUser,
  signInAnonymously,
  signInWithGoogle,
  signOutCurrentUser,
  deleteDiaryEntry,
  type AuthUser,
  type DiaryEntry,
} from './src/services/appwriteDiary';
import { ThemeProvider, useTheme } from './src/theme/ThemeProvider';

const displayFont = Platform.select({
  ios: 'AvenirNext-DemiBold',
  android: 'sans-serif-condensed',
  default: 'Trebuchet MS',
});

const bodyFont = Platform.select({
  ios: 'AvenirNext-Regular',
  android: 'sans-serif',
  default: 'Segoe UI',
});

const monoFont = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'Consolas',
});

export default function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}

function AppContent() {
  const { theme, toggleTheme, isDark } = useTheme();
  const heroEntrance = useRef(new Animated.Value(0)).current;
  const composerEntrance = useRef(new Animated.Value(0)).current;
  const historyEntrance = useRef(new Animated.Value(0)).current;

  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [draft, setDraft] = useState('');
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [historyStatus, setHistoryStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAuthBusy, setIsAuthBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const isConfigValid = appwriteConfigError === null;
  const displayedEntries = useMemo(
    () =>
      entries.map((entry) => ({
        ...entry,
        formattedCreatedAt: new Date(entry.createdAt).toLocaleString(),
      })),
    [entries],
  );

  const wait = (milliseconds: number): Promise<void> =>
    new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    });

  useEffect(() => {
    const entranceAnimations = [heroEntrance, composerEntrance, historyEntrance].map((value) =>
      Animated.timing(value, {
        toValue: 1,
        duration: 520,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: Platform.OS !== 'web',
      }),
    );

    Animated.stagger(120, entranceAnimations).start();
  }, [composerEntrance, heroEntrance, historyEntrance]);

  useEffect(() => {
    let isMounted = true;

    const loadEntries = async () => {
      if (appwriteConfigError) {
        setHistoryStatus('failed');
        setErrorMessage(appwriteConfigError);
        return;
      }

      try {
        let existingUser = await getCurrentUser();
        if (!existingUser && Platform.OS === 'web') {
          for (let attempt = 0; attempt < 4; attempt += 1) {
            await wait(350);
            existingUser = await getCurrentUser();
            if (existingUser) {
              break;
            }
          }
        }

        const readyUser = existingUser ?? (await signInAnonymously());

        if (!isMounted) {
          return;
        }

        setCurrentUser(readyUser);
        const loadedEntries = await fetchDiaryEntries();
        if (!isMounted) {
          return;
        }

        setEntries(loadedEntries);
        setHistoryStatus('ready');
        setErrorMessage(null);
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setHistoryStatus('failed');
        setErrorMessage(getDiaryErrorMessage(error));
      }
    };

    void loadEntries();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleGoogleSignIn = async () => {
    if (isAuthBusy || !isConfigValid) {
      return;
    }

    try {
      setIsAuthBusy(true);
      const signedInUser = await signInWithGoogle();
      setCurrentUser(signedInUser);
      const loadedEntries = await fetchDiaryEntries();
      setEntries(loadedEntries);
      setHistoryStatus('ready');
      setErrorMessage(null);
    } catch (error) {
      const authMessage = getDiaryErrorMessage(error);
      if (authMessage !== 'Opening Google sign-in...') {
        setErrorMessage(authMessage);
      }
    } finally {
      setIsAuthBusy(false);
    }
  };

  const handleSignOut = async () => {
    if (isAuthBusy || !isConfigValid) {
      return;
    }

    try {
      setIsAuthBusy(true);
      await signOutCurrentUser();
      const anonymousUser = await signInAnonymously();
      setCurrentUser(anonymousUser);
      const loadedEntries = await fetchDiaryEntries();
      setEntries(loadedEntries);
      setHistoryStatus('ready');
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(getDiaryErrorMessage(error));
    } finally {
      setIsAuthBusy(false);
    }
  };

  const handleAddEntry = async () => {
    if (historyStatus === 'loading' || isSubmitting || isAuthBusy || !isConfigValid) {
      return;
    }

    const cleanedDraft = draft.trim();
    if (!cleanedDraft) {
      return;
    }

    try {
      setIsSubmitting(true);
      const newEntry = await createDiaryEntry(cleanedDraft);

      setEntries((previousEntries) => [
        newEntry,
        ...previousEntries.filter((entry) => entry.id !== newEntry.id),
      ]);
      setDraft('');
      setHistoryStatus('ready');
      setErrorMessage(null);
    } catch (error) {
      setHistoryStatus('failed');
      setErrorMessage(getDiaryErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteEntry = async (id: string, previewText?: string) => {
    if (historyStatus === 'loading' || isAuthBusy || !isConfigValid) {
      return;
    }

    const confirmDelete = Platform.OS === 'web'
      ? window.confirm('Delete this memory? This action cannot be undone.')
      : await new Promise<boolean>((resolve) => {
          Alert.alert(
            'Delete memory',
            'Delete this memory? This action cannot be undone.',
            [
              { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
              { text: 'Delete', style: 'destructive', onPress: () => resolve(true) },
            ],
          );
        });

    if (!confirmDelete) {
      return;
    }

    try {
      setDeletingId(id);
      await deleteDiaryEntry(id);
      setEntries((prev) => prev.filter((e) => e.id !== id));
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(getDiaryErrorMessage(error));
    } finally {
      setDeletingId(null);
    }
  };

  const emptyStateMessage =
    historyStatus === 'loading'
      ? 'Loading history...'
      : historyStatus === 'failed'
        ? (errorMessage ?? 'Could not load previous history yet.')
        : 'No entries yet.';
  const isAddButtonDisabled =
    historyStatus === 'loading' || isSubmitting || isAuthBusy || !isConfigValid;
  const displayName =
    currentUser?.name?.trim() || currentUser?.email?.trim() || 'Guest';
  const authStatusLabel = currentUser?.isAnonymous
    ? 'Signed in as guest'
    : `Signed in as ${displayName}`;
  const isGoogleSignInDisabled =
    isAuthBusy || !isConfigValid || (currentUser !== null && !currentUser.isAnonymous);
  const isSignOutDisabled = isAuthBusy || !isConfigValid || currentUser === null || currentUser.isAnonymous;
  const entryCountLabel = entries.length === 1 ? '1 memory' : `${entries.length} memories`;

  const getEntranceStyle = (animationValue: Animated.Value) => ({
    opacity: animationValue,
    transform: [
      {
        translateY: animationValue.interpolate({
          inputRange: [0, 1],
          outputRange: [18, 0],
        }),
      },
    ],
  });

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
      <View pointerEvents="none" style={styles.backgroundDecor}>
        <View style={[styles.backgroundOrb, styles.backgroundOrbOne, { backgroundColor: theme.colors.orbOne }]} />
        <View style={[styles.backgroundOrb, styles.backgroundOrbTwo, { backgroundColor: theme.colors.orbTwo }]} />
        <View style={[styles.backgroundOrb, styles.backgroundOrbThree, { backgroundColor: theme.colors.orbThree }]} />
      </View>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
      >
        <View style={styles.contentShell}>
          <Animated.View
            style={[
              styles.heroCard,
              {
                backgroundColor: theme.colors.surfaceElevated,
                borderColor: theme.colors.border,
              },
              getEntranceStyle(heroEntrance),
            ]}
          >
            <View style={styles.heroTopRow}>
              <View>
                <Text style={[styles.kicker, { color: theme.colors.secondary }]}>DAY CAPTURE</Text>
                <Text style={[styles.title, { color: theme.colors.text }]}>Your vibe, your diary.</Text>
              </View>
              <Pressable
                onPress={toggleTheme}
                accessibilityRole="button"
                accessibilityLabel="Toggle theme"
                style={({ pressed }) => [
                  styles.themeChip,
                  { backgroundColor: theme.colors.chipBackground },
                  pressed ? styles.addButtonPressed : null,
                ]}
              >
                <Text style={[styles.themeChipText, { color: theme.colors.chipText }]}>
                  {isDark ? 'Light mode' : 'Dark mode'}
                </Text>
              </Pressable>
            </View>

            <Text style={[styles.heroDescription, { color: theme.colors.muted }]}>Tap into the moment and save your story before it fades.</Text>
            <View style={[styles.userChip, { backgroundColor: theme.colors.chipBackground }]}> 
              <Text style={[styles.userLabel, { color: theme.colors.chipText }]}>{authStatusLabel}</Text>
            </View>

            <View style={styles.authActionsRow}>
              <Pressable
                onPress={handleGoogleSignIn}
                disabled={isGoogleSignInDisabled}
                accessibilityRole="button"
                accessibilityLabel="Sign in with Google"
                style={({ pressed }) => [
                  styles.authButton,
                  { backgroundColor: theme.colors.primary },
                  isGoogleSignInDisabled ? styles.addButtonDisabled : null,
                  pressed ? styles.addButtonPressed : null,
                ]}
              >
                <Text style={[styles.authButtonText, { color: theme.colors.buttonText }]}>Google Sign In</Text>
              </Pressable>
              <Pressable
                onPress={handleSignOut}
                disabled={isSignOutDisabled}
                accessibilityRole="button"
                accessibilityLabel="Sign out"
                style={({ pressed }) => [
                  styles.authButton,
                  { backgroundColor: theme.colors.secondary },
                  isSignOutDisabled ? styles.addButtonDisabled : null,
                  pressed ? styles.addButtonPressed : null,
                ]}
              >
                <Text style={[styles.authButtonText, { color: theme.colors.buttonText }]}>Sign Out</Text>
              </Pressable>
            </View>
          </Animated.View>

          <Animated.View
            style={[
              styles.composerCard,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
              getEntranceStyle(composerEntrance),
            ]}
          >
            <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Write It Down</Text>
            <TextInput
              placeholder="What made today unforgettable?"
              placeholderTextColor={theme.colors.muted}
              accessibilityLabel="Diary entry input"
              value={draft}
              onChangeText={setDraft}
              multiline
              style={[
                styles.input,
                {
                  backgroundColor: theme.colors.inputBackground,
                  borderColor: theme.colors.border,
                  color: theme.colors.text,
                },
              ]}
              textAlignVertical="top"
            />
            {errorMessage ? (
              <View
                style={[
                  styles.errorBanner,
                  {
                    backgroundColor: theme.colors.dangerBackground,
                    borderColor: theme.colors.border,
                  },
                ]}
              >
                <Text style={[styles.errorBannerText, { color: theme.colors.dangerText }]}>{errorMessage}</Text>
              </View>
            ) : null}
            <Pressable
              onPress={handleAddEntry}
              disabled={isAddButtonDisabled}
              accessibilityRole="button"
              accessibilityLabel="Add diary entry"
              style={({ pressed }) => [
                styles.addButton,
                { backgroundColor: theme.colors.primary },
                isAddButtonDisabled ? styles.addButtonDisabled : null,
                pressed ? styles.addButtonPressed : null,
              ]}
            >
              <Text style={[styles.addButtonText, { color: theme.colors.buttonText }]}>Save Memory</Text>
            </Pressable>
          </Animated.View>

          <Animated.View
            style={[
              styles.historyWrap,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.border,
              },
              getEntranceStyle(historyEntrance),
            ]}
          >
            <View style={styles.historyHeader}>
              <Text style={[styles.historyTitle, { color: theme.colors.text }]}>History</Text>
              <Text style={[styles.historyMeta, { color: theme.colors.muted }]}>{entryCountLabel}</Text>
            </View>
            <FlatList
              data={displayedEntries}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <View
                  style={[
                    styles.entryCard,
                    {
                      backgroundColor: theme.colors.surfaceElevated,
                      borderColor: theme.colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.entryText, { color: theme.colors.text }]}>{item.text}</Text>
                  <Text style={[styles.entryDate, { color: theme.colors.muted }]}>
                    {item.formattedCreatedAt}
                  </Text>
                  <Pressable
                    onPress={() => void handleDeleteEntry(item.id, item.text)}
                    disabled={deletingId === item.id || isAuthBusy || !isConfigValid}
                    accessibilityRole="button"
                    accessibilityLabel="Delete diary entry"
                    style={({ pressed }) => [
                      styles.deleteButton,
                      pressed ? styles.addButtonPressed : null,
                      deletingId === item.id ? styles.addButtonDisabled : null,
                    ]}
                  >
                    <Text style={[styles.deleteButtonText, { color: theme.colors.dangerText ?? '#b00020' }]}>Delete</Text>
                  </Pressable>
                </View>
              )}
              ListEmptyComponent={
                <Text style={[styles.emptyText, { color: theme.colors.muted }]}>{emptyStateMessage}</Text>
              }
              contentContainerStyle={entries.length === 0 ? styles.emptyContainer : styles.listContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            />
          </Animated.View>
        </View>

        <StatusBar style={theme.statusBarStyle} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f2f5ff',
  },
  backgroundDecor: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  backgroundOrb: {
    position: 'absolute',
    borderRadius: 999,
  },
  backgroundOrbOne: {
    width: 220,
    height: 220,
    top: -60,
    right: -40,
  },
  backgroundOrbTwo: {
    width: 180,
    height: 180,
    bottom: 140,
    left: -55,
  },
  backgroundOrbThree: {
    width: 260,
    height: 260,
    bottom: -110,
    right: -80,
  },
  container: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 8,
  },
  contentShell: {
    flex: 1,
    width: '100%',
    maxWidth: 780,
    alignSelf: 'center',
    gap: 12,
  },
  heroCard: {
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 16,
    shadowColor: '#0f1430',
    shadowOpacity: 0.15,
    shadowRadius: 16,
    shadowOffset: {
      width: 0,
      height: 8,
    },
    elevation: 4,
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
  },
  kicker: {
    fontSize: 11,
    letterSpacing: 1.7,
    textTransform: 'uppercase',
    fontFamily: monoFont,
    marginBottom: 6,
  },
  title: {
    fontSize: 30,
    fontWeight: '700',
    lineHeight: 36,
    fontFamily: displayFont,
  },
  themeChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  themeChipText: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: bodyFont,
  },
  heroDescription: {
    marginTop: 10,
    fontSize: 14,
    lineHeight: 21,
    fontFamily: bodyFont,
  },
  userChip: {
    marginTop: 12,
    borderRadius: 999,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  userLabel: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: monoFont,
  },
  authActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 12,
  },
  authButton: {
    minWidth: 140,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
  },
  authButtonText: {
    fontSize: 14,
    fontWeight: '600',
    fontFamily: bodyFont,
  },
  composerCard: {
    borderRadius: 22,
    borderWidth: 1,
    padding: 14,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 10,
    fontFamily: displayFont,
  },
  input: {
    minHeight: 132,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    fontSize: 16,
    lineHeight: 22,
    fontFamily: bodyFont,
  },
  errorBanner: {
    marginTop: 9,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  errorBannerText: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: bodyFont,
  },
  addButton: {
    marginTop: 11,
    alignSelf: 'stretch',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  addButtonPressed: {
    opacity: 0.84,
  },
  addButtonDisabled: {
    opacity: 0.48,
  },
  addButtonText: {
    fontSize: 16,
    fontWeight: '700',
    fontFamily: bodyFont,
  },
  historyWrap: {
    flex: 1,
    borderRadius: 22,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  historyTitle: {
    fontSize: 20,
    fontWeight: '700',
    fontFamily: displayFont,
  },
  historyMeta: {
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    fontFamily: monoFont,
  },
  listContent: {
    paddingBottom: 16,
  },
  emptyContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingBottom: 10,
  },
  emptyText: {
    textAlign: 'center',
    fontSize: 15,
    lineHeight: 21,
    fontFamily: bodyFont,
  },
  entryCard: {
    borderRadius: 14,
    padding: 13,
    marginBottom: 10,
    borderWidth: 1,
  },
  entryText: {
    fontSize: 16,
    lineHeight: 22,
    fontFamily: bodyFont,
  },
  entryDate: {
    marginTop: 8,
    fontSize: 12,
    fontFamily: monoFont,
  },
  deleteButton: {
    marginTop: 10,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  deleteButtonText: {
    fontSize: 13,
    fontWeight: '700',
    fontFamily: bodyFont,
  },
});
