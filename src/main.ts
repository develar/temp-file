import {ensureDir, mkdtemp, realpath, remove, removeSync, unlink, unlinkSync} from "fs-extra"
import {tmpdir} from "os"
import * as path from "path"

let tmpFileCounter = 0
const tmpDirManagers = new Set<TmpDir>()

// add date to avoid use stale temp dir
const tempDirPrefix = `${process.pid.toString(36)}-${Date.now().toString(36)}`

export function getTempName(prefix?: string | null | undefined): string {
  return `${prefix == null ? "" : `${prefix}-`}${tempDirPrefix}-${(tmpFileCounter++).toString(36)}`
}

let tempDirPromise: Promise<string> | null
let tempBaseDir: string | null

function getBaseTempDir(): Promise<string> {
  if (tempDirPromise != null) {
    return tempDirPromise
  }

  if (tempBaseDir != null) {
    return Promise.resolve(tempBaseDir)
  }

  const systemTmpDir = process.env.APP_BUILDER_TMP_DIR || tmpdir()
  const isEnsureRemovedOnExit = process.env.TMP_DIR_MANAGER_ENSURE_REMOVED_ON_EXIT !== "false"
  tempDirPromise = mkdtemp(path.join(systemTmpDir, "t-"))
    .then(it => realpath(it))
    .then(dir => {
      if (isEnsureRemovedOnExit) {
        addExitHook(dir)
      }
      tempBaseDir = dir
      return dir
    })
  return tempDirPromise
}

function addExitHook(dir: string) {
  require("async-exit-hook")((callback: (() => void) | null) => {
    const managers = Array.from(tmpDirManagers)
    tmpDirManagers.clear()

    if (callback == null) {
      for (const manager of managers) {
        manager.cleanupSync()
      }

      try {
        removeSync(dir)
      }
      catch (e) {
        handleError(e, dir)
      }
      return
    }

    Promise.all(managers.map(it => it.cleanup()))
      .then(() => remove(dir))
      .then(() => callback())
      .catch(e => {
        try {
          handleError(e, dir)
        }
        finally {
          callback()
        }
      })
  })
}

function handleError(e: any, file: string) {
  if (e.code !== "EPERM" && e.code !== "ENOENT") {
    // use only console.* instead of our warn on exit (otherwise nodeEmoji can be required on request)
    console.warn(`Cannot delete temporary "${file}": ${(e.stack || e).toString()}`)
  }
}

interface TempFileInfo {
  isDir: boolean
  path: string
  disposer?: ((file: string) => Promise<void>) | null
}

export interface GetTempFileOptions {
  prefix?: string | null
  suffix?: string | null

  disposer?: ((file: string) => Promise<void>) | null
}

export class TmpDir {
  private tempFiles: Array<TempFileInfo> = []
  private registered = false

  constructor(private readonly debugName: string = "") {
  }

  // noinspection JSMethodCanBeStatic,JSUnusedGlobalSymbols
  get rootTempDir(): Promise<string> {
    return getBaseTempDir()
  }

  getTempDir(options?: GetTempFileOptions): Promise<string> {
    return this.getTempFile(options, true)
  }

  createTempDir(options?: GetTempFileOptions): Promise<string> {
    return this.getTempFile(options, true)
      .then(it => ensureDir(it).then(() => it))
  }

  getTempFile(options?: GetTempFileOptions, isDir = false): Promise<string> {
    return getBaseTempDir()
      .then(baseTempDir => {
        if (!this.registered) {
          this.registered = true
          tmpDirManagers.add(this)
        }

        const prefix = nullize(options == null ? null : options.prefix)
        const suffix = nullize(options == null ? null : options.suffix)
        const namePrefix = prefix == null ? "" : `${prefix}-`
        const nameSuffix = suffix == null ? "" : (suffix.startsWith(".") ? suffix : `-${suffix}`)
        const result = `${baseTempDir}${path.sep}${namePrefix}${(tmpFileCounter++).toString(36)}${nameSuffix}`
        this.tempFiles.push({
          path: result,
          isDir,
          disposer: options == null ? null : options.disposer,
        })
        return result
      })
  }

  cleanupSync() {
    const tempFiles = this.tempFiles
    tmpDirManagers.delete(this)
    this.registered = false
    if (tempFiles.length === 0) {
      return
    }

    this.tempFiles = []

    for (const file of tempFiles) {
      if (file.disposer != null) {
        // noinspection JSIgnoredPromiseFromCall
        file.disposer(file.path)
        continue
      }

      try {
        if (file.isDir) {
          removeSync(file.path)
        }
        else {
          unlinkSync(file.path)
        }
      }
      catch (e) {
        handleError(e, file.path)
      }
    }
  }

  cleanup(): Promise<any> {
    const tempFiles = this.tempFiles
    tmpDirManagers.delete(this)

    this.registered = false
    if (tempFiles.length === 0) {
      return Promise.resolve()
    }
    this.tempFiles = []

    if (tmpDirManagers.size === 0) {
      const dir = tempBaseDir
      if (dir == null) {
        return Promise.resolve()
      }

      tempBaseDir = null
      tempDirPromise = null
      return remove(dir)
    }

    return Promise.all(tempFiles.map(it => {
      if (it.disposer != null) {
        return it.disposer(it.path)
      }

      return (it.isDir ? remove(it.path) : unlink(it.path))
        .catch(e => {
          handleError(e, it.path)
        })
    }))
  }

  toString() {
    return this.debugName
  }
}

function nullize(s?: string | null) {
  return s == null || s.length === 0 ? null : s
}