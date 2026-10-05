import { Button, ButtonProps } from '@mui/material';
import { forwardRef } from 'react';

/** ButtonProps + suporte ao estado de carregamento (loading spinner). */
export type LoadingButtonProps = ButtonProps & { loading?: boolean };

export const PrimaryButton = forwardRef<HTMLButtonElement, LoadingButtonProps>(
  ({ children, disabled, loading, startIcon, endIcon, ...props }, ref) => (
    <Button
      ref={ref}
      variant="contained"
      color="primary"
      disabled={disabled || loading}
      startIcon={loading ? <span className="spinner" /> : startIcon}
      endIcon={endIcon}
      {...props}
    >
      {children}
    </Button>
  )
);

PrimaryButton.displayName = 'PrimaryButton';

export const SecondaryButton = forwardRef<HTMLButtonElement, LoadingButtonProps>(
  ({ children, disabled, loading, startIcon, endIcon, ...props }, ref) => (
    <Button
      ref={ref}
      variant="outlined"
      color="primary"
      disabled={disabled || loading}
      startIcon={loading ? <span className="spinner" /> : startIcon}
      endIcon={endIcon}
      {...props}
    >
      {children}
    </Button>
  )
);

SecondaryButton.displayName = 'SecondaryButton';

export const DangerButton = forwardRef<HTMLButtonElement, LoadingButtonProps>(
  ({ children, disabled, loading, startIcon, endIcon, ...props }, ref) => (
    <Button
      ref={ref}
      variant="contained"
      color="error"
      disabled={disabled || loading}
      startIcon={loading ? <span className="spinner" /> : startIcon}
      endIcon={endIcon}
      {...props}
    >
      {children}
    </Button>
  )
);

DangerButton.displayName = 'DangerButton';

export const GhostButton = forwardRef<HTMLButtonElement, LoadingButtonProps>(
  ({ children, disabled, loading, startIcon, endIcon, ...props }, ref) => (
    <Button
      ref={ref}
      variant="text"
      disabled={disabled || loading}
      startIcon={loading ? <span className="spinner" /> : startIcon}
      endIcon={endIcon}
      {...props}
    >
      {children}
    </Button>
  )
);

GhostButton.displayName = 'GhostButton';