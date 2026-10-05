import { Box, Button, IconButton, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Grid, Alert, Tooltip, Snackbar, Typography } from '@mui/material';
import { PhotoCamera, AddAPhoto, QrCode, Close, Delete, Download, Fullscreen } from '@mui/icons-material';
import { useState, useRef, useEffect } from 'react';
import { serviceOrdersApi } from '../../services/api';
import QRCode from 'qrcode';

interface OSPhotoUploadProps {
  osId: string;
  photos?: Array<{ id: string; url: string; caption?: string; createdAt: string }>;
  onPhotosChange?: (photos: Array<{ id: string; url: string; caption?: string; createdAt: string }>) => void;
}

export function OSPhotoUpload({ osId, photos = [], onPhotosChange }: OSPhotoUploadProps) {
  const [capturing, setCapturing] = useState(false);
  const [qrDialogOpen, setQrDialogOpen] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' as 'success' | 'error' });
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const generateQRCode = async () => {
    try {
      const tokenResponse = await serviceOrdersApi.getPhotoToken(osId);
      const token = tokenResponse.data?.token;
      if (!token) throw new Error('Token não gerado');
      
      // URL para o mobile: /mobile-upload/:id?token=...
      const mobileUrl = `${window.location.origin}/mobile-upload/${osId}?token=${encodeURIComponent(token)}`;
      const qrDataUrl = await QRCode.toDataURL(mobileUrl, { width: 256, margin: 2 });
      setQrCodeUrl(qrDataUrl);
      setQrDialogOpen(true);
    } catch (e) {
      console.error('Erro ao gerar QR Code:', e);
      showSnackbar('Erro ao gerar QR Code', 'error');
    }
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' }, 
        audio: false 
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCapturing(true);
    } catch (e) {
      console.error('Erro ao acessar câmera:', e);
      showSnackbar('Erro ao acessar câmera. Verifique permissões.', 'error');
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setCapturing(false);
  };

  const capturePhoto = () => {
    if (!videoRef.current) return;
    
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(videoRef.current, 0, 0);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
      uploadPhoto(dataUrl);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          uploadPhoto(event.target.result as string);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const uploadPhoto = async (dataUrl: string) => {
    setUploading(true);
    try {
      // Converter dataUrl para Blob
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      const file = new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' });
      
      const result = await serviceOrdersApi.addPhoto(osId, file);
      const newPhoto = result.data || result;
      
      if (onPhotosChange) {
        onPhotosChange([...photos, newPhoto]);
      }
      showSnackbar('Foto enviada com sucesso!', 'success');
    } catch (e) {
      console.error('Erro ao enviar foto:', e);
      showSnackbar('Erro ao enviar foto', 'error');
    } finally {
      setUploading(false);
    }
  };

  const deletePhoto = async (photoId: string) => {
    try {
      await serviceOrdersApi.deletePhoto(photoId);
      if (onPhotosChange) {
        onPhotosChange(photos.filter(p => p.id !== photoId));
      }
      showSnackbar('Foto excluída', 'success');
    } catch (e) {
      console.error('Erro ao excluir foto:', e);
      showSnackbar('Erro ao excluir foto', 'error');
    }
  };

  const showSnackbar = (message: string, severity: 'success' | 'error') => {
    setSnackbar({ open: true, message, severity });
  };

  const openPreview = (index: number) => {
    setPreviewIndex(index);
    setPreviewDialogOpen(true);
  };

  const downloadPhoto = (url: string, filename: string) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
  };

  // Cleanup ao desmontar
  useEffect(() => {
    return () => {
      stopCamera();
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, []);

  const typingTimeoutRef = useRef<NodeJS.Timeout>();

  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6">Fotos da OS</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Tooltip title="Câmera do Computador">
            <Button variant="outlined" startIcon={<PhotoCamera />} onClick={capturing ? stopCamera : startCamera}>
              {capturing ? 'Parar Câmera' : 'Webcam'}
            </Button>
          </Tooltip>
          <Tooltip title="Arquivo do Computador">
            <Button variant="outlined" startIcon={<AddAPhoto />} onClick={() => document.getElementById('file-input')?.click()}>
              Arquivo
            </Button>
          </Tooltip>
          <Tooltip title="Câmera do Celular (QR Code)">
            <Button variant="outlined" startIcon={<QrCode />} onClick={generateQRCode}>
              Celular
            </Button>
          </Tooltip>
          <input
            id="file-input"
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
        </Box>
      </Box>

      {/* Webcam */}
      {capturing && (
        <Box sx={{ position: 'relative', mb: 2, borderRadius: 1, overflow: 'hidden', bgcolor: '#000' }}>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            style={{ width: '100%', maxHeight: 400, display: 'block' }}
          />
          <Box sx={{ position: 'absolute', bottom: 10, left: 10, right: 10, display: 'flex', justifyContent: 'space-between', p: 1 }}>
            <Button variant="outlined" color="inherit" onClick={stopCamera} startIcon={<Close />}>
              Cancelar
            </Button>
            <Button variant="contained" color="primary" onClick={capturePhoto} startIcon={<PhotoCamera />} size="large">
              Capturar
            </Button>
          </Box>
        </Box>
      )}

      {/* Grid de fotos */}
      {photos.length > 0 && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 1, color: 'text.secondary' }}>
            {photos.length} foto(s)
          </Typography>
          <Grid container spacing={2}>
            {photos.map((photo, index) => (
              <Grid item xs={6} sm={4} md={3} lg={2} key={photo.id}>
                <Box
                  sx={{
                    position: 'relative',
                    aspectRatio: '1/1',
                    borderRadius: 1,
                    overflow: 'hidden',
                    border: 1,
                    borderColor: 'divider',
                    cursor: 'pointer',
                    transition: 'transform 0.2s',
                    '&:hover': { transform: 'scale(1.02)' },
                  }}
                  onClick={() => openPreview(index)}
                >
                  <img
                    src={photo.url}
                    alt={photo.caption || `Foto ${index + 1}`}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                  <Box sx={{ position: 'absolute', top: 4, right: 4, display: 'flex', gap: 1 }}>
                    <Tooltip title="Download">
                      <IconButton size="small" color="inherit" onClick={(e) => { e.stopPropagation(); downloadPhoto(photo.url, `foto-${photo.id}.jpg`); }}>
                        <Download fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Excluir">
                      <IconButton size="small" color="error" onClick={(e) => { e.stopPropagation(); deletePhoto(photo.id); }}>
                        <Delete fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Box>
                  {photo.caption && (
                    <Box sx={{ position: 'absolute', bottom: 0, left: 0, right: 0, p: 1, bgcolor: 'rgba(0,0,0,0.7)', color: 'white' }}>
                      <Typography variant="caption" noWrap>{photo.caption}</Typography>
                    </Box>
                  )}
                </Box>
              </Grid>
            ))}
          </Grid>
        </Box>
      )}

      {/* QR Code Dialog */}
      <Dialog open={qrDialogOpen} onClose={() => setQrDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <Typography>Câmera do Celular</Typography>
            <IconButton onClick={() => setQrDialogOpen(false)}><Close /></IconButton>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ textAlign: 'center', p: 2 }}>
          {qrCodeUrl && (
            <Box sx={{ display: 'inline-block', p: 2, bgcolor: 'white', borderRadius: 1 }}>
              <img src={qrCodeUrl} alt="QR Code para upload mobile" style={{ width: 256, height: 256 }} />
            </Box>
          )}
          <Typography variant="body2" sx={{ mt: 2, color: 'text.secondary' }}>
            Escaneie com a câmera do celular para abrir a página de upload
          </Typography>
          <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'text.secondary' }}>
            O link expira em 15 minutos
          </Typography>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog open={previewDialogOpen} onClose={() => setPreviewDialogOpen(false)} maxWidth="xl" fullWidth fullScreen>
        <DialogTitle>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <Typography>{photos[previewIndex]?.caption || `Foto ${previewIndex + 1}`}</Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Tooltip title="Download">
                <IconButton onClick={() => downloadPhoto(photos[previewIndex].url, `foto-${photos[previewIndex].id}.jpg`)}>
                  <Download />
                </IconButton>
              </Tooltip>
              <Tooltip title="Fechar">
                <IconButton onClick={() => setPreviewDialogOpen(false)}><Close /></IconButton>
              </Tooltip>
            </Box>
          </Box>
        </DialogTitle>
        <DialogContent>
          <Box sx={{ textAlign: 'center', maxHeight: '80vh', overflow: 'auto' }}>
            <img
              src={photos[previewIndex]?.url}
              alt={`Foto ${previewIndex + 1}`}
              style={{ maxWidth: '100%', maxHeight: '80vh', borderRadius: 1 }}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPreviewIndex(i => i > 0 ? i - 1 : photos.length - 1)} disabled={photos.length <= 1}>
            Anterior
          </Button>
          <Button onClick={() => setPreviewIndex(i => i < photos.length - 1 ? i + 1 : 0)} disabled={photos.length <= 1}>
            Próxima
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
      >
        <Alert severity={snackbar.severity} onClose={() => setSnackbar({ ...snackbar, open: false })} variant="filled">
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}