import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  Activity,
  ContactRound,
  Copy,
  FolderPlus,
  LoaderCircle,
  Mail,
  Play,
  Plus,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Wrench,
  X
} from 'lucide-react'
import type {
  EmailContact,
  EmailMessage,
  EmailMessageInput,
  EmailProfile,
  MockServer
} from '../../shared/contracts'
import { ToolExplorer } from './ToolExplorer'

interface EmailStudioProps {
  server: MockServer | null
  emails: EmailMessage[]
  busy: boolean
  onAddServer: () => void
  onToggleServer: () => void
  onReset: () => Promise<boolean>
  onCopyEndpoint: () => void
  onCopyConfig: () => void
  onOpenInspector: () => void
  onMailboxChanged: () => Promise<void>
}

const protectedFolders = new Set(['Inbox', 'Sent', 'Drafts', 'Archive'])

function localDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16)
}

function newMessageDraft(
  profile: EmailProfile,
  contact?: EmailContact
): EmailMessageInput {
  return {
    folder: 'Inbox',
    fromName: contact?.name ?? '',
    fromEmail: contact?.email ?? '',
    toEmail: profile.email,
    subject: '',
    body: '',
    sentAt: new Date().toISOString(),
    parentEmailId: null
  }
}

function messageInput(email: EmailMessage): EmailMessageInput {
  return {
    folder: email.folder,
    fromName: email.fromName,
    fromEmail: email.fromEmail,
    toEmail: email.toEmail,
    subject: email.subject,
    body: email.body,
    sentAt: email.sentAt,
    parentEmailId: email.parentEmailId
  }
}

export function EmailStudio({
  server,
  emails,
  busy,
  onAddServer,
  onToggleServer,
  onReset,
  onCopyEndpoint,
  onCopyConfig,
  onOpenInspector,
  onMailboxChanged
}: EmailStudioProps) {
  const workspaceId = server?.workspaceId ?? ''
  const [profile, setProfile] = useState<EmailProfile | null>(null)
  const [contacts, setContacts] = useState<EmailContact[]>([])
  const [folders, setFolders] = useState<string[]>([])
  const [loading, setLoading] = useState(!!server)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [newFolder, setNewFolder] = useState('')
  const [messageDraft, setMessageDraft] = useState<EmailMessageInput | null>(
    null
  )
  const [editingEmailId, setEditingEmailId] = useState<string | null>(null)
  const [contactDraft, setContactDraft] = useState<EmailContact | null>(null)
  const [editingContactEmail, setEditingContactEmail] = useState<string | null>(
    null
  )

  const loadMailbox = useCallback(
    () =>
      Promise.all([
        window.mockarium.getEmailProfile(workspaceId),
        window.mockarium.getEmailFolders(workspaceId),
        window.mockarium.getEmailContacts(workspaceId)
      ]),
    [workspaceId]
  )

  useEffect(() => {
    if (!workspaceId) return
    let active = true
    void loadMailbox()
      .then(([nextProfile, nextFolders, nextContacts]) => {
        if (!active) return
        setProfile(nextProfile)
        setFolders(nextFolders)
        setContacts(nextContacts)
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(
            caught instanceof Error
              ? caught.message
              : 'Could not load the Email mock.'
          )
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [loadMailbox, workspaceId])

  const runChange = async (
    action: () => Promise<unknown>,
    successMessage: string,
    refreshProfile = false
  ): Promise<boolean> => {
    setSaving(true)
    setError('')
    setNotice('')
    try {
      await action()
      const [nextProfile, nextFolders, nextContacts] = await loadMailbox()
      if (refreshProfile) setProfile(nextProfile)
      setFolders(nextFolders)
      setContacts(nextContacts)
      await onMailboxChanged()
      setNotice(successMessage)
      return true
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not save this change.'
      )
      return false
    } finally {
      setSaving(false)
    }
  }

  const resetMailbox = async () => {
    if (!(await onReset())) return
    setSaving(true)
    setError('')
    try {
      const [nextProfile, nextFolders, nextContacts] = await loadMailbox()
      setProfile(nextProfile)
      setFolders(nextFolders)
      setContacts(nextContacts)
      setMessageDraft(null)
      setEditingEmailId(null)
      setContactDraft(null)
      setEditingContactEmail(null)
      setNewFolder('')
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not reload the mailbox.'
      )
    } finally {
      setSaving(false)
    }
  }

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!profile || !workspaceId) return
    await runChange(
      () => window.mockarium.saveEmailProfile(workspaceId, profile),
      'Mailbox identity saved',
      true
    )
  }

  const saveMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!messageDraft || !workspaceId) return
    const saved = await runChange(
      () =>
        window.mockarium.saveEmail(workspaceId, editingEmailId, messageDraft),
      editingEmailId ? 'Message updated' : 'Message added to the mailbox'
    )
    if (saved) {
      setMessageDraft(null)
      setEditingEmailId(null)
    }
  }

  const saveContact = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!contactDraft || !workspaceId) return
    const saved = await runChange(
      () =>
        window.mockarium.saveEmailContact(
          workspaceId,
          editingContactEmail,
          contactDraft
        ),
      editingContactEmail ? 'Contact updated' : 'Contact added'
    )
    if (saved) {
      setContactDraft(null)
      setEditingContactEmail(null)
    }
  }

  const addFolder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!workspaceId || !newFolder.trim()) return
    const saved = await runChange(
      () => window.mockarium.addEmailFolder(workspaceId, newFolder),
      'Folder added'
    )
    if (saved) setNewFolder('')
  }

  if (!server) {
    return (
      <div className="email-studio">
        <section className="email-studio-welcome">
          <div className="email-studio-welcome-icon">
            <Mail size={24} />
          </div>
          <span className="eyebrow">YOUR MAILBOX, YOUR RULES</span>
          <h2>Make an inbox that feels real to your agent.</h2>
          <p>
            Set the mailbox identity, create believable messages, organize
            folders, and build an address book your agent can explore.
          </p>
          <button
            className="button button-primary"
            type="button"
            onClick={onAddServer}
            disabled={busy}
          >
            {busy ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <Sparkles size={15} />
            )}
            Create my starter mailbox
          </button>
          <span className="email-studio-footnote">
            <ShieldCheck size={14} /> Safe sample data. No real emails are sent.
          </span>
        </section>
      </div>
    )
  }

  return (
    <div className="email-studio">
      <section className="email-studio-banner">
        <div className="email-studio-banner-icon">
          <Mail size={19} />
        </div>
        <div>
          <span className="eyebrow">EMAIL STUDIO · MOCK MAILBOX</span>
          <h2>Give your agent a mailbox with a story.</h2>
          <p>Customize the identity, messages, folders, and people it sees.</p>
        </div>
        <div className="email-studio-stats">
          <span>
            <strong>{emails.length}</strong> messages
          </span>
          <span>
            <strong>{folders.length}</strong> folders
          </span>
          <span>
            <strong>{contacts.length}</strong> contacts
          </span>
        </div>
      </section>

      {error && (
        <div className="inline-alert" role="alert">
          <span>{error}</span>
          <button
            type="button"
            aria-label="Dismiss error"
            onClick={() => setError('')}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {notice && (
        <div className="toast-notice" role="status">
          {notice}
        </div>
      )}

      <section className="panel email-connection">
        <div className="email-connection-top">
          <div className="email-connection-title">
            <div className="email-connection-icon">
              <Sparkles size={17} />
            </div>
            <div>
              <span className="eyebrow">YOUR AGENT CONNECTION</span>
              <h3>Email mock server</h3>
              <p>
                {server.running
                  ? 'Ready for your agent to explore this mailbox.'
                  : 'Start the server to connect your agent.'}
              </p>
            </div>
          </div>
          <div className="studio-server-controls">
            <span
              className={`tag-status ${server.running ? 'tag-running' : 'tag-stopped'}`}
            >
              <span className="status-dot" />
              {server.running ? 'Running' : 'Stopped'}
            </span>
            <button
              className="button button-primary studio-server-button"
              type="button"
              onClick={onToggleServer}
              disabled={busy || saving}
            >
              {busy ? (
                <LoaderCircle className="spin" size={15} />
              ) : server.running ? (
                <Square size={13} />
              ) : (
                <Play size={15} />
              )}
              {server.running ? 'Stop email server' : 'Start email server'}
            </button>
          </div>
        </div>
        {server.running && server.endpoint && (
          <div className="email-connection-endpoint">
            <div>
              <span className="eyebrow">LOCAL MCP ENDPOINT</span>
              <code>{server.endpoint}</code>
            </div>
            <button
              className="button button-secondary button-small"
              type="button"
              onClick={onCopyEndpoint}
            >
              <Copy size={13} /> Copy URL
            </button>
            <button
              className="button button-secondary button-small"
              type="button"
              onClick={onCopyConfig}
            >
              <Copy size={13} /> Copy config
            </button>
          </div>
        )}
        <div className="email-connection-actions">
          <button
            className="button button-secondary"
            type="button"
            onClick={onOpenInspector}
          >
            <Activity size={14} /> Live Inspector
          </button>
          <button
            className="button button-quiet"
            type="button"
            onClick={() => void resetMailbox()}
            disabled={busy || saving || loading}
          >
            <RotateCcw size={14} /> Restore starter mailbox
          </button>
          <span className="email-connection-safety">
            <ShieldCheck size={14} /> Local only · No real emails sent
          </span>
        </div>
        <details className="email-connection-details">
          <summary>
            <Wrench size={13} /> Connection details
          </summary>
          <div className="email-connection-details-content">
            {server.running && server.endpoint ? (
              <>
                <p>
                  In MCP Inspector, choose Streamable HTTP and enter the
                  endpoint above. Client configuration formats vary.
                </p>
                <div className="connection-config">
                  <div className="connection-config-head">
                    <span>Generic HTTP client configuration</span>
                    <button
                      className="text-button"
                      type="button"
                      onClick={onCopyConfig}
                    >
                      <Copy size={13} /> Copy
                    </button>
                  </div>
                  <pre>
                    {JSON.stringify(
                      {
                        mcpServers: {
                          'mockarium-email': {
                            type: 'http',
                            url: server.endpoint
                          }
                        }
                      },
                      null,
                      2
                    )}
                  </pre>
                </div>
              </>
            ) : (
              <p>
                Start the server to reveal its local endpoint and configuration.
              </p>
            )}
          </div>
        </details>
      </section>

      <ToolExplorer key={server.id} server={server} />

      {loading ? (
        <div className="email-studio-loading">
          <LoaderCircle className="spin" size={18} /> Loading mailbox settings…
        </div>
      ) : (
        <>
          {profile && (
            <section className="panel email-studio-panel email-profile-panel">
              <div className="email-studio-section-heading">
                <div>
                  <span className="eyebrow">MAILBOX IDENTITY</span>
                  <h3>Who is your agent?</h3>
                  <p>
                    This identity appears on emails the agent sends or drafts.
                  </p>
                </div>
              </div>
              <form className="email-studio-inline-form" onSubmit={saveProfile}>
                <label>
                  Display name
                  <input
                    value={profile.name}
                    maxLength={80}
                    onChange={(event) =>
                      setProfile({ ...profile, name: event.target.value })
                    }
                    required
                  />
                </label>
                <label>
                  Email address
                  <input
                    type="email"
                    value={profile.email}
                    maxLength={254}
                    onChange={(event) =>
                      setProfile({ ...profile, email: event.target.value })
                    }
                    required
                  />
                </label>
                <button
                  className="button button-primary"
                  type="submit"
                  disabled={saving}
                >
                  {saving ? (
                    <LoaderCircle className="spin" size={14} />
                  ) : (
                    <Save size={14} />
                  )}
                  Save identity
                </button>
              </form>
            </section>
          )}

          <div className="email-studio-grid">
            <section className="panel email-studio-panel email-messages-panel">
              <div className="email-studio-section-heading">
                <div>
                  <span className="eyebrow">MAILBOX CONTENT</span>
                  <h3>Messages your agent can discover</h3>
                  <p>
                    Add context, edit a fixture, or remove a message from this
                    simulated inbox.
                  </p>
                </div>
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() => {
                    if (!profile) return
                    setEditingEmailId(null)
                    setMessageDraft(newMessageDraft(profile, contacts[0]))
                  }}
                  disabled={saving || !profile}
                >
                  <Plus size={14} /> Add message
                </button>
              </div>

              {messageDraft && (
                <form className="email-studio-editor" onSubmit={saveMessage}>
                  <div className="email-studio-editor-heading">
                    <strong>
                      {editingEmailId ? 'Edit message' : 'New mailbox message'}
                    </strong>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Close message editor"
                      onClick={() => {
                        setMessageDraft(null)
                        setEditingEmailId(null)
                      }}
                    >
                      <X size={15} />
                    </button>
                  </div>
                  <div className="email-studio-form-grid">
                    <label>
                      Folder
                      <select
                        value={messageDraft.folder}
                        onChange={(event) =>
                          setMessageDraft({
                            ...messageDraft,
                            folder: event.target.value
                          })
                        }
                      >
                        {folders.map((folder) => (
                          <option key={folder} value={folder}>
                            {folder}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Date and time
                      <input
                        type="datetime-local"
                        value={localDateTime(messageDraft.sentAt)}
                        onChange={(event) =>
                          setMessageDraft({
                            ...messageDraft,
                            sentAt: event.target.value
                              ? new Date(event.target.value).toISOString()
                              : ''
                          })
                        }
                        required
                      />
                    </label>
                    <label>
                      From name
                      <input
                        value={messageDraft.fromName}
                        maxLength={80}
                        onChange={(event) =>
                          setMessageDraft({
                            ...messageDraft,
                            fromName: event.target.value
                          })
                        }
                        required
                      />
                    </label>
                    <label>
                      From email
                      <input
                        type="email"
                        value={messageDraft.fromEmail}
                        maxLength={254}
                        onChange={(event) =>
                          setMessageDraft({
                            ...messageDraft,
                            fromEmail: event.target.value
                          })
                        }
                        required
                      />
                    </label>
                    <label>
                      To
                      <input
                        type="email"
                        value={messageDraft.toEmail}
                        maxLength={254}
                        onChange={(event) =>
                          setMessageDraft({
                            ...messageDraft,
                            toEmail: event.target.value
                          })
                        }
                        required
                      />
                    </label>
                    <label>
                      Subject
                      <input
                        value={messageDraft.subject}
                        maxLength={300}
                        onChange={(event) =>
                          setMessageDraft({
                            ...messageDraft,
                            subject: event.target.value
                          })
                        }
                        required
                      />
                    </label>
                    <label className="email-studio-wide-field">
                      Message
                      <textarea
                        value={messageDraft.body}
                        maxLength={20_000}
                        rows={5}
                        onChange={(event) =>
                          setMessageDraft({
                            ...messageDraft,
                            body: event.target.value
                          })
                        }
                        required
                      />
                    </label>
                  </div>
                  <div className="email-studio-editor-actions">
                    <button
                      className="button button-primary"
                      type="submit"
                      disabled={saving}
                    >
                      {saving ? (
                        <LoaderCircle className="spin" size={14} />
                      ) : (
                        <Save size={14} />
                      )}
                      Save message
                    </button>
                  </div>
                </form>
              )}

              {emails.length === 0 ? (
                <div className="email-studio-empty">
                  <Mail size={17} />
                  <strong>No messages yet</strong>
                  <span>Add the first message to give your agent context.</span>
                </div>
              ) : (
                <div className="email-studio-message-list">
                  {emails.map((email) => (
                    <article className="email-studio-message" key={email.id}>
                      <div className="email-studio-message-main">
                        <span className="email-studio-folder-tag">
                          {email.folder}
                        </span>
                        <strong>{email.subject}</strong>
                        <span>
                          {email.fromName} ·{' '}
                          {new Date(email.sentAt).toLocaleDateString()}
                        </span>
                        <p>{email.body}</p>
                      </div>
                      <div className="email-studio-item-actions">
                        <button
                          type="button"
                          className="button button-quiet"
                          onClick={() => {
                            setEditingEmailId(email.id)
                            setMessageDraft(messageInput(email))
                          }}
                          disabled={saving}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="icon-button danger-text"
                          aria-label={`Delete ${email.subject}`}
                          title="Delete message"
                          onClick={() => {
                            if (
                              window.confirm(
                                `Remove “${email.subject}” from this mailbox?`
                              )
                            ) {
                              void runChange(
                                () =>
                                  window.mockarium.deleteEmail(
                                    workspaceId,
                                    email.id
                                  ),
                                'Message removed'
                              )
                            }
                          }}
                          disabled={saving}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <div className="email-studio-side-column">
              <section className="panel email-studio-panel">
                <div className="email-studio-section-heading">
                  <div>
                    <span className="eyebrow">ADDRESS BOOK</span>
                    <h3>Familiar people</h3>
                    <p>Contacts are available through the agent’s MCP tools.</p>
                  </div>
                  <button
                    className="icon-button"
                    type="button"
                    aria-label="Add contact"
                    title="Add contact"
                    onClick={() => {
                      setEditingContactEmail(null)
                      setContactDraft({ name: '', email: '', company: '' })
                    }}
                    disabled={saving}
                  >
                    <Plus size={16} />
                  </button>
                </div>
                {contactDraft && (
                  <form
                    className="email-studio-compact-editor"
                    onSubmit={saveContact}
                  >
                    <label>
                      Name
                      <input
                        value={contactDraft.name}
                        maxLength={80}
                        onChange={(event) =>
                          setContactDraft({
                            ...contactDraft,
                            name: event.target.value
                          })
                        }
                        required
                      />
                    </label>
                    <label>
                      Email
                      <input
                        type="email"
                        value={contactDraft.email}
                        maxLength={254}
                        onChange={(event) =>
                          setContactDraft({
                            ...contactDraft,
                            email: event.target.value
                          })
                        }
                        required
                      />
                    </label>
                    <label>
                      Company
                      <input
                        value={contactDraft.company}
                        maxLength={120}
                        onChange={(event) =>
                          setContactDraft({
                            ...contactDraft,
                            company: event.target.value
                          })
                        }
                      />
                    </label>
                    <div className="email-studio-editor-actions">
                      <button
                        className="button button-primary"
                        type="submit"
                        disabled={saving}
                      >
                        <Save size={13} /> Save contact
                      </button>
                      <button
                        className="button button-quiet"
                        type="button"
                        onClick={() => {
                          setContactDraft(null)
                          setEditingContactEmail(null)
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
                {contacts.length === 0 ? (
                  <div className="email-studio-empty compact">
                    <ContactRound size={16} />
                    <span>Your address book is empty.</span>
                  </div>
                ) : (
                  <div className="email-studio-contact-list">
                    {contacts.map((contact) => (
                      <div className="email-studio-contact" key={contact.email}>
                        <span className="email-studio-contact-avatar">
                          {contact.name.slice(0, 1).toUpperCase()}
                        </span>
                        <div>
                          <strong>{contact.name}</strong>
                          <span>{contact.email}</span>
                          {contact.company && <small>{contact.company}</small>}
                        </div>
                        <div className="email-studio-item-actions">
                          <button
                            type="button"
                            className="button button-quiet"
                            onClick={() => {
                              setEditingContactEmail(contact.email)
                              setContactDraft({ ...contact })
                            }}
                            disabled={saving}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="icon-button danger-text"
                            aria-label={`Delete ${contact.name}`}
                            onClick={() =>
                              void runChange(
                                () =>
                                  window.mockarium.deleteEmailContact(
                                    workspaceId,
                                    contact.email
                                  ),
                                'Contact removed'
                              )
                            }
                            disabled={saving}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="panel email-studio-panel">
                <div className="email-studio-section-heading">
                  <div>
                    <span className="eyebrow">FOLDER MAP</span>
                    <h3>Organize the inbox</h3>
                    <p>Create folders and sort messages into them.</p>
                  </div>
                  <FolderPlus size={17} />
                </div>
                <form className="email-studio-folder-form" onSubmit={addFolder}>
                  <input
                    aria-label="New folder name"
                    placeholder="e.g. Project Apollo"
                    value={newFolder}
                    maxLength={40}
                    onChange={(event) => setNewFolder(event.target.value)}
                    required
                  />
                  <button
                    className="button button-secondary"
                    type="submit"
                    disabled={saving || !newFolder.trim()}
                  >
                    <Plus size={14} /> Add
                  </button>
                </form>
                <div className="email-studio-folder-list">
                  {folders.map((folder) => {
                    const count = emails.filter(
                      (email) => email.folder === folder
                    ).length
                    return (
                      <div className="email-studio-folder" key={folder}>
                        <span>{folder}</span>
                        <small>{count}</small>
                        {!protectedFolders.has(folder) && (
                          <button
                            type="button"
                            className="icon-button danger-text"
                            aria-label={`Delete ${folder} folder`}
                            title={
                              count > 0
                                ? 'Move or delete its messages first'
                                : 'Delete folder'
                            }
                            onClick={() =>
                              void runChange(
                                () =>
                                  window.mockarium.deleteEmailFolder(
                                    workspaceId,
                                    folder
                                  ),
                                'Folder removed'
                              )
                            }
                            disabled={saving || count > 0}
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </section>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
