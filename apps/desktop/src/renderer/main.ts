/**
 * Desktop renderer entry: the desktop transport wiring over the same web
 * shell kernel the browser surface uses. Everything else — loader holding,
 * module-table seeding, plugin assembly — lives in @deepseek-ai/dsh-client-web;
 * this file only wires the IPC carrier and finds the mount point.
 */
import { bootstrapDesktop } from './transport.ts'

const el = document.getElementById('root')
if (el === null) throw new Error('desktop app: missing #root')
void bootstrapDesktop(el)
