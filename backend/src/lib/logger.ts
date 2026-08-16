type Level = 'debug' | 'info' | 'warn' | 'error'

function emit(level: Level, message: string, fields: Record<string, unknown> = {}): void {
  const entry = {
    level,
    time: new Date().toISOString(),
    msg: message,
    ...fields,
  }
  const line = JSON.stringify(entry)
  if (level === 'error') process.stderr.write(line + '\n')
  else process.stdout.write(line + '\n')
}

export const logger = {
  debug: (message: string, fields?: Record<string, unknown>) => emit('debug', message, fields),
  info: (message: string, fields?: Record<string, unknown>) => emit('info', message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => emit('warn', message, fields),
  error: (message: string, fields?: Record<string, unknown>) => emit('error', message, fields),
}
