import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import type { Conversation, Message } from '@cerquita/types';
import { ApiError } from '@cerquita/api-client';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { theme } from '@/lib/theme';

/** How often the thread re-checks for messages from the other side. */
const POLL_MS = 8_000;

/**
 * A conversation.
 *
 * Same contract as the web thread: sending is optimistic and carries a
 * `clientId`, which the API treats as an idempotency key — on a phone, where a
 * connection drops mid-send far more often than on a desktop, that is the
 * difference between a retry and a duplicate message.
 */
export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useSession();

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const listRef = useRef<FlatList<Message>>(null);

  const refresh = useCallback(async () => {
    if (!id) return;
    const page = await api.chat.messages(id);
    setMessages(page.items);
    setPending((current) =>
      current.filter((draft) => !page.items.some((message) => message.id === draft.id)),
    );
  }, [id]);

  useEffect(() => {
    if (!id || !user) return;
    let cancelled = false;

    (async () => {
      try {
        const [thread] = await Promise.all([api.chat.conversation(id), refresh()]);
        if (cancelled) return;
        setConversation(thread);
        await api.chat.markRead(id);
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof ApiError ? cause.message : 'No pudimos abrir la conversación.');
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    const timer = setInterval(() => {
      // A failed poll is not worth interrupting the conversation over.
      void refresh().catch(() => undefined);
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [id, refresh, user]);

  if (!user) return <Text style={styles.state}>Entrá para ver esta conversación.</Text>;
  if (!ready) return <ActivityIndicator style={styles.state} color={theme.color.accent} />;
  if (error && !conversation) return <Text style={styles.state}>{error}</Text>;

  const viewerId = user.userId;
  const other =
    conversation?.participants.find((participant) => participant.id !== viewerId) ??
    conversation?.participants[0];

  async function send() {
    const body = draft.trim();
    if (!body || !id) return;

    const clientId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimistic: Message = {
      id: clientId,
      conversationId: id,
      kind: 'text',
      body,
      senderId: viewerId,
      createdAt: new Date().toISOString(),
    };

    setPending((current) => [...current, optimistic]);
    setDraft('');
    setError(null);

    try {
      const sent = await api.chat.send(id, body, clientId);
      setMessages((current) => [...current, sent]);
      setPending((current) => current.filter((message) => message.id !== clientId));
    } catch (cause) {
      // The draft comes back so nothing typed is lost.
      setPending((current) => current.filter((message) => message.id !== clientId));
      setDraft(body);
      setError(cause instanceof ApiError ? cause.message : 'No pudimos enviar el mensaje.');
    }
  }

  const timeline = [...messages, ...pending];

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      {other && (
        <Text style={styles.who}>
          {other.displayName}
          {conversation?.listing ? ` · ${conversation.listing.title}` : ''}
        </Text>
      )}

      <FlatList
        ref={listRef}
        data={timeline}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.thread}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        renderItem={({ item }) => {
          const mine = item.senderId === viewerId;
          const isPending = pending.some((draft) => draft.id === item.id);
          return (
            <View
              style={[
                styles.bubble,
                mine ? styles.mine : styles.theirs,
                isPending && styles.pending,
              ]}
            >
              <Text style={mine ? styles.mineText : styles.theirsText}>{item.body}</Text>
            </View>
          );
        }}
        ListEmptyComponent={
          <Text style={styles.empty}>
            Todavía no hay mensajes. Preguntá si sigue disponible o coordiná dónde verse.
          </Text>
        }
      />

      {/* Spec §46: the platform never holds the money, and says so. */}
      <Text style={styles.safety}>
        Cerquita no retiene el pago. Coordiná en un lugar público y revisá el producto antes de
        pagar.
      </Text>

      {error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Escribí un mensaje…"
          placeholderTextColor={theme.color.textTertiary}
          multiline
          accessibilityLabel="Escribí un mensaje"
        />
        <Pressable
          style={[styles.send, !draft.trim() && styles.disabled]}
          disabled={!draft.trim()}
          onPress={() => void send()}
          accessibilityRole="button"
        >
          <Text style={styles.sendText}>Enviar</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.color.background },
  state: { marginTop: theme.space.xl, textAlign: 'center', color: theme.color.textTertiary },
  who: {
    paddingHorizontal: theme.space.md,
    paddingBottom: theme.space.xs,
    fontSize: theme.font.size.sm,
    color: theme.color.textTertiary,
  },
  thread: { padding: theme.space.md, gap: theme.space.xs },
  bubble: { maxWidth: '78%', padding: theme.space.sm, borderRadius: theme.radius.lg },
  mine: { alignSelf: 'flex-end', backgroundColor: theme.color.brand },
  theirs: { alignSelf: 'flex-start', backgroundColor: theme.color.surface },
  pending: { opacity: 0.6 },
  mineText: { color: theme.color.textInverse, fontSize: theme.font.size.base },
  theirsText: { color: theme.color.text, fontSize: theme.font.size.base },
  empty: {
    marginTop: theme.space.lg,
    textAlign: 'center',
    color: theme.color.textTertiary,
    fontSize: theme.font.size.base,
  },
  safety: {
    marginHorizontal: theme.space.md,
    marginBottom: theme.space.xs,
    padding: theme.space.sm,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.surface,
    fontSize: theme.font.size.xs,
    color: theme.color.textSecondary,
  },
  error: {
    marginHorizontal: theme.space.md,
    marginBottom: theme.space.xs,
    fontSize: theme.font.size.sm,
    color: theme.color.danger,
  },
  composer: {
    flexDirection: 'row',
    gap: theme.space.sm,
    padding: theme.space.md,
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 110,
    paddingHorizontal: theme.space.md,
    paddingTop: 12,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.color.surface,
    fontSize: theme.font.size.md,
    color: theme.color.text,
  },
  send: {
    height: 44,
    paddingHorizontal: theme.space.md,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendText: { color: theme.color.textInverse, fontWeight: theme.font.weight.bold },
  disabled: { opacity: 0.45 },
});
