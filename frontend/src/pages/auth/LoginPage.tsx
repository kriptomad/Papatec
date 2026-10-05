import { Box, Card, CardContent, TextField, Button, Typography, Alert, CircularProgress, Link } from '@mui/material';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '../../store/auth';
import { authApi } from '../../services/api';
import { PrimaryButton } from '../../components/ui/Buttons';
import '../../components/ui/LoginPage.css';

const loginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(6, 'Mínimo 6 caracteres'),
});

type LoginForm = z.infer<typeof loginSchema>;

export function LoginPage() {
  const navigate = useNavigate();
  const { login, setupAdmin } = useAuth();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [isFirstAdmin, setIsFirstAdmin] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginForm) => {
    setError('');
    setLoading(true);
    try {
      if (isFirstAdmin) {
        await setupAdmin({ email: data.email, password: data.password, name: 'Administrador' });
      } else {
        await login(data.email, data.password);
      }
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Erro ao fazer login');
    } finally {
      setLoading(false);
    }
  };

  const checkFirstAdmin = async () => {
    try {
      const status = await authApi.setupStatus();
      setIsFirstAdmin(!!status?.needsSetup);
      if (!status?.needsSetup) {
        setError('Já existe um usuário configurado. Faça login normalmente.');
      }
    } catch {
      setIsFirstAdmin(false);
    }
  };

  useEffect(() => {
    authApi
      .setupStatus()
      .then((status) => setIsFirstAdmin(!!status?.needsSetup))
      .catch(() => setIsFirstAdmin(false));
  }, []);

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2, background: 'linear-gradient(135deg, #f5f7fa 0%, #e4e8f0 100%)' }}>
      <Card sx={{ maxWidth: 420, width: '100%', boxShadow: 3 }}>
        <CardContent sx={{ p: 4 }}>
          <Box sx={{ textAlign: 'center', mb: 4 }}>
            <Box
              component="img"
              src="/logo-papatec.png"
              alt="Papatec"
              sx={{ height: { xs: 56, sm: 72 }, width: 'auto', mb: 1.5, display: 'inline-block' }}
            />
            <Typography
              variant="subtitle1"
              fontWeight={600}
              color="text.secondary"
              sx={{ mb: 1, letterSpacing: 2, textTransform: 'uppercase', fontSize: '0.8rem' }}
            >
              Sistema Loja
            </Typography>
            <Typography variant="body1" color="text.secondary">
              {isFirstAdmin ? 'Configuração Inicial - Crie o Admin' : 'Acesse sua conta'}
            </Typography>
          </Box>

          {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

          <form onSubmit={handleSubmit(onSubmit)} noValidate>
            <TextField
              fullWidth
              label="Email"
              type="email"
              {...register('email')}
              error={!!errors.email}
              helperText={errors.email?.message}
              margin="normal"
              autoComplete="email"
              autoFocus
              required
            />
            <TextField
              fullWidth
              label="Senha"
              type="password"
              {...register('password')}
              error={!!errors.password}
              helperText={errors.password?.message}
              margin="normal"
              autoComplete="current-password"
              required
            />
            
            <PrimaryButton 
              type="submit" 
              fullWidth 
              size="large" 
              loading={loading}
              sx={{ mt: 3, mb: 2 }}
            >
              {isFirstAdmin ? 'Criar Admin e Entrar' : 'Entrar'}
            </PrimaryButton>
          </form>

          {isFirstAdmin ? null : (
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
              Primeira vez? <Link onClick={checkFirstAdmin} sx={{ cursor: 'pointer', color: 'primary.main', fontWeight: 500 }}>Criar primeiro admin</Link>
            </Typography>
          )}

          <Box sx={{ mt: 3, pt: 2, borderTop: 1, borderColor: 'divider', textAlign: 'center' }}>
            <Typography variant="caption" color="text.secondary">
              Papatec v1.0 • Filitech
            </Typography>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}