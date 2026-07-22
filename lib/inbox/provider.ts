// Swappable mail-transport interface. Nylas is the only implementation today; this seam lets the
// transport change later (direct MS Graph / Gmail, Unipile, …) without touching the queue/UI logic.

import { NylasProvider } from './nylas'
import type {
  ListThreadsOptions,
  ListThreadsResult,
  MailFolder,
  MailMessage,
  MailThread,
  SendMessageInput,
  SendMessageResult,
} from './types'

export interface MailProvider {
  readonly name: string
  listThreads(opts?: ListThreadsOptions): Promise<ListThreadsResult>
  getThread(threadId: string): Promise<MailThread>
  listMessages(threadId: string): Promise<MailMessage[]>
  getMessage(messageId: string): Promise<MailMessage>
  sendMessage(input: SendMessageInput): Promise<SendMessageResult>
  /** Cancel a previously scheduled send (send_at) by its provider schedule id. */
  cancelScheduledSend(scheduleId: string): Promise<void>
  listFolders(): Promise<MailFolder[]>
  moveMessageToFolder(messageId: string, folderId: string): Promise<void>
  setMessageFlags(messageId: string, flags: { unread?: boolean; starred?: boolean }): Promise<void>
  /** Stream an attachment's raw bytes (provider ids). The route proxies these to the client. */
  downloadAttachment(
    attachmentId: string,
    providerMessageId: string
  ): Promise<{ body: ReadableStream<Uint8Array> | null; contentType: string | null; contentLength: string | null }>
}

// The minimal shape of an inbox_accounts row the factory needs.
export type ProviderAccount = {
  provider: string
  nylas_grant_id: string | null
  email_address?: string | null
}

// Return the transport client for a connected mailbox.
export function getMailProvider(account: ProviderAccount): MailProvider {
  switch (account.provider) {
    case 'nylas':
      if (!account.nylas_grant_id) throw new Error('inbox account has no nylas_grant_id')
      return new NylasProvider(account.nylas_grant_id, account.email_address || null)
    default:
      throw new Error(`Unsupported inbox provider: ${account.provider}`)
  }
}
