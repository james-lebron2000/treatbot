'use client';

import React from 'react';
import { AlertTriangle, RotateCcw, Clipboard } from 'lucide-react';
import { Button } from '@/components/ui/Button';

type ErrorBoundaryProps = {
  children: React.ReactNode;
  onReset?: () => void;
};

type ErrorBoundaryState = {
  error: Error | null;
};

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('UI error boundary caught:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  handleCopyDiagnostics = async () => {
    if (!this.state.error) return;
    const payload = `${this.state.error.message}\n${this.state.error.stack ?? ''}`;
    try {
      await navigator.clipboard.writeText(payload);
    } catch (clipboardError) {
      console.warn('Failed to copy diagnostics', clipboardError);
    }
  };

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div className="rounded-3xl border border-red-100 bg-red-50/80 p-6 text-slate-600 shadow-inner">
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-red-500" />
          <div>
            <p className="text-sm font-semibold text-red-600">页面发生错误</p>
            <p className="text-xs text-red-500/80">{this.state.error.message}</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="primary"
            size="sm"
            className="rounded-full px-4"
            onClick={this.handleReset}
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            重试
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="rounded-full px-4"
            onClick={this.handleCopyDiagnostics}
          >
            <Clipboard className="mr-2 h-4 w-4" />
            复制诊断信息
          </Button>
        </div>
      </div>
    );
  }
}
