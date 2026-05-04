/**
 * Error Boundary para capturar errores de React automáticamente
 * Se integra con el sistema de logging de errores
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Home, RefreshCw } from 'lucide-react';
import { logSystemErrorAsync } from '@/lib/systemErrorLogger';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  private onWindowError?: (event: ErrorEvent) => void;
  private onUnhandledRejection?: (event: PromiseRejectionEvent) => void;

  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('❌ Error capturado por ErrorBoundary:', error, errorInfo);
    
    this.setState({
      error,
      errorInfo,
    });

    // Registrar en la BD
    this.logError(error, errorInfo);
  }

  componentDidMount() {
    this.onWindowError = (event: ErrorEvent) => {
      const err = event.error instanceof Error ? event.error : null;
      logSystemErrorAsync({
        errorMessage: err?.message || event.message || 'WindowError sin mensaje',
        stackTrace: err?.stack ?? null,
        componentName: 'window.onerror',
        metadata: {
          source: event.filename,
          line: event.lineno,
          column: event.colno,
        },
      });
    };

    this.onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const message =
        reason instanceof Error
          ? reason.message
          : typeof reason === 'string'
            ? reason
            : 'Unhandled promise rejection';
      let reasonText = 'unknown';
      if (reason instanceof Error) {
        reasonText = reason.message;
      } else if (typeof reason === 'string') {
        reasonText = reason;
      } else {
        try {
          reasonText = JSON.stringify(reason ?? null);
        } catch {
          reasonText = String(reason);
        }
      }

      logSystemErrorAsync({
        errorMessage: message,
        stackTrace: reason instanceof Error ? reason.stack : null,
        componentName: 'window.unhandledrejection',
        metadata: {
          reasonText,
        },
      });
    };

    window.addEventListener('error', this.onWindowError);
    window.addEventListener('unhandledrejection', this.onUnhandledRejection);
  }

  componentWillUnmount() {
    if (this.onWindowError) {
      window.removeEventListener('error', this.onWindowError);
    }
    if (this.onUnhandledRejection) {
      window.removeEventListener('unhandledrejection', this.onUnhandledRejection);
    }
  }

  async logError(error: Error, errorInfo: ErrorInfo) {
    const componentStack = errorInfo.componentStack || '';
    const componentMatch = componentStack.match(/at (\w+)/);
    const component = componentMatch ? componentMatch[1] : 'UnknownComponent';

    logSystemErrorAsync({
      errorMessage: error.message || String(error),
      stackTrace: error.stack ?? null,
      componentName: component,
      metadata: {
        source: 'react_error_boundary',
        componentStack,
      },
    });
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  handleGoHome = () => {
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gradient-to-br from-red-50 via-orange-50 to-yellow-50 flex items-center justify-center p-6">
          <Card className="max-w-2xl w-full border-red-200">
            <CardHeader>
              <div className="flex items-center gap-3 mb-2">
                <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
                  <AlertTriangle className="h-6 w-6 text-red-600" />
                </div>
                <div>
                  <CardTitle className="text-2xl text-red-900">
                    ¡Ups! Algo salió mal
                  </CardTitle>
                  <CardDescription>
                    La aplicación encontró un error inesperado
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-sm font-semibold text-red-900 mb-2">
                  Error:
                </p>
                <p className="text-sm text-red-800 font-mono">
                  {this.state.error?.message || 'Error desconocido'}
                </p>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-blue-900">
                  <strong>✓ El error ha sido registrado automáticamente.</strong>
                  <br />
                  Nuestro equipo técnico será notificado y trabajará en solucionarlo.
                </p>
              </div>

              <div className="flex gap-3">
                <Button
                  onClick={this.handleReset}
                  className="flex-1"
                  variant="outline"
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Intentar de Nuevo
                </Button>
                <Button
                  onClick={this.handleGoHome}
                  className="flex-1"
                >
                  <Home className="h-4 w-4 mr-2" />
                  Volver al Inicio
                </Button>
              </div>

              {/* Detalles técnicos (colapsados) */}
              {process.env.NODE_ENV === 'development' && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                    Ver detalles técnicos (Desarrollo)
                  </summary>
                  <div className="mt-2 bg-gray-100 rounded-lg p-3">
                    <pre className="text-xs overflow-x-auto">
                      {this.state.error?.stack}
                    </pre>
                    {this.state.errorInfo && (
                      <div className="mt-4">
                        <p className="text-sm font-semibold mb-2">Component Stack:</p>
                        <pre className="text-xs overflow-x-auto">
                          {this.state.errorInfo.componentStack}
                        </pre>
                      </div>
                    )}
                  </div>
                </details>
              )}
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

