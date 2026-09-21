import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ApiError } from '@cerquita/api-client';
import { useSession } from '@/lib/session';
import { theme } from '@/lib/theme';

/**
 * Sign in, or the signed-in account.
 *
 * One screen for both because the signed-out state IS the sign-in form — a
 * separate route would mean a redirect the moment the session restores, which
 * on a phone reads as a flicker.
 */
export default function AccountScreen() {
  const { user, loading, login, register, logout } = useSession();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <ActivityIndicator style={styles.state} color={theme.color.accent} />;

  if (user) {
    return (
      <View style={styles.content}>
        <Text style={styles.name}>@{user.username}</Text>
        <Text style={styles.note}>
          Ya estás dentro. Vas a ver precios de amigo y las publicaciones de la gente que seguís.
        </Text>
        <Pressable
          style={styles.secondary}
          onPress={() => void logout()}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryText}>Cerrar sesión</Text>
        </Pressable>
      </View>
    );
  }

  const isRegister = mode === 'register';

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (isRegister) {
        await register({
          email: email.trim(),
          password,
          username: username.trim().toLowerCase(),
          displayName: displayName.trim(),
        });
      } else {
        await login(email.trim(), password);
      }
    } catch (cause) {
      // The API writes its messages in Spanish and for humans.
      setError(cause instanceof ApiError ? cause.message : 'No pudimos conectar con el servidor.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.title}>{isRegister ? 'Crear cuenta' : 'Entrar'}</Text>
      <Text style={styles.note}>
        {isRegister
          ? 'Con tu cuenta podés publicar, ofertar y ver precios de amigo.'
          : 'Entrá para ver precios de amigo y lo que publica la gente que conocés.'}
      </Text>

      {error && <Text style={styles.error}>{error}</Text>}

      {isRegister && (
        <>
          <Field label="Tu nombre" value={displayName} onChange={setDisplayName} />
          <Field label="Usuario" value={username} onChange={setUsername} autoCapitalize="none" />
        </>
      )}

      <Field
        label="Email"
        value={email}
        onChange={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
      />
      <Field label="Contraseña" value={password} onChange={setPassword} secure />

      <Pressable
        style={[styles.primary, busy && styles.disabled]}
        disabled={busy}
        onPress={() => void submit()}
        accessibilityRole="button"
      >
        <Text style={styles.primaryText}>
          {busy ? 'Un segundo…' : isRegister ? 'Crear cuenta' : 'Entrar'}
        </Text>
      </Pressable>

      <Pressable
        onPress={() => setMode(isRegister ? 'login' : 'register')}
        accessibilityRole="button"
      >
        <Text style={styles.switch}>
          {isRegister ? '¿Ya tenés cuenta? Entrá' : '¿No tenés cuenta? Creála'}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

function Field({
  label,
  value,
  onChange,
  secure,
  keyboardType,
  autoCapitalize,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  secure?: boolean;
  keyboardType?: 'default' | 'email-address';
  autoCapitalize?: 'none' | 'sentences';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        secureTextEntry={secure}
        keyboardType={keyboardType ?? 'default'}
        autoCapitalize={autoCapitalize ?? 'sentences'}
        autoCorrect={false}
        accessibilityLabel={label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  state: { marginTop: theme.space.xl },
  content: { padding: theme.space.lg, gap: theme.space.sm },
  title: {
    fontSize: theme.font.size.xxl,
    fontWeight: theme.font.weight.black,
    color: theme.color.text,
  },
  name: {
    fontSize: theme.font.size.xl,
    fontWeight: theme.font.weight.black,
    color: theme.color.text,
  },
  note: {
    marginBottom: theme.space.md,
    fontSize: theme.font.size.md,
    color: theme.color.textSecondary,
  },
  error: {
    padding: theme.space.sm,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.dangerSubtle,
    color: theme.color.danger,
    fontSize: theme.font.size.sm,
    fontWeight: theme.font.weight.semibold,
  },
  field: { gap: 4 },
  label: {
    fontSize: theme.font.size.sm,
    fontWeight: theme.font.weight.semibold,
    color: theme.color.textSecondary,
  },
  input: {
    height: 48,
    paddingHorizontal: theme.space.md,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.color.surface,
    fontSize: theme.font.size.md,
    color: theme.color.text,
  },
  primary: {
    height: 48,
    marginTop: theme.space.md,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: theme.color.textInverse, fontWeight: theme.font.weight.bold },
  secondary: {
    height: 48,
    marginTop: theme.space.md,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { color: theme.color.danger, fontWeight: theme.font.weight.bold },
  disabled: { opacity: 0.55 },
  switch: {
    marginTop: theme.space.md,
    textAlign: 'center',
    color: theme.color.textSecondary,
    fontWeight: theme.font.weight.semibold,
  },
});
