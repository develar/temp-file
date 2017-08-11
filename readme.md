## temp-file

[![Greenkeeper badge](https://badges.greenkeeper.io/develar/temp-file.svg)](https://greenkeeper.io/)

```typescript
export function getTempName(prefix?: string | null | undefined): string;

export class TmpDir {
    getTempDir(suffix?: string): Promise<string>;
    
    createTempDir(suffix?: string): Promise<string>;
    
    getTempFile(suffix: string, isDir?: boolean, disposer?: ((file: string) => Promise<void>) | null): Promise<string>;
    
    cleanupSync(): void;
    
    cleanup(): Promise<any>;
}
```