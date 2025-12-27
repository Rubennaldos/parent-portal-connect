import React from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, RotateCcw } from "lucide-react";

type AppErrorBoundaryState = {
  error: Error | null;
};

export class AppErrorBoundary extends React.Component<
  React.PropsWithChildren,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  // Avoid logging sensitive details; render them only behind <details>.
  componentDidCatch() {
    // no-op
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
        <Card className="w-full max-w-xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Error al cargar la app
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Ocurrió un error en el navegador. Si es un tema de configuración,
              revisa las variables de entorno/Secrets.
            </p>

            <div className="rounded-md bg-muted p-3 text-sm font-mono break-words">
              {error.message || "Error inesperado"}
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <Button onClick={() => window.location.reload()}>
                <RotateCcw className="h-4 w-4 mr-2" />
                Recargar
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  window.location.href = "/auth";
                }}
              >
                Ir a iniciar sesión
              </Button>
            </div>

            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">
                Detalles técnicos
              </summary>
              <pre className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">
                {error.stack}
              </pre>
            </details>
          </CardContent>
        </Card>
      </main>
    );
  }
}
