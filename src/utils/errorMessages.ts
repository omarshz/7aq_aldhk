/** Map raw error objects to short, friendly messages for the speech bubble. */
export function toFriendlyError(error: unknown): string {
  const msg = typeof error === 'string'
    ? error.toLowerCase()
    : error instanceof Error
      ? error.message.toLowerCase()
      : '';

  if (!msg) {
    return "I can't seem to see anything right now!";
  }

  if (msg.includes('connection') || msg.includes('refused') || msg.includes('network')) {
    return "I can't reach my brain right now -- is LM Studio running?";
  }
  if (msg.includes('timeout') || msg.includes('timed out')) {
    return 'My brain is taking too long to respond... try again in a moment!';
  }
  if (msg.includes('capture') || msg.includes('screenshot') || msg.includes('monitor')) {
    return "I couldn't get a look at your screen. Something blocked my view!";
  }
  if (msg.includes('parse') || msg.includes('json')) {
    return 'I got a weird response and could not make sense of it.';
  }
  if (msg.includes('security') || msg.includes('localhost')) {
    return 'The LLM endpoint must be a localhost address.';
  }

  return "Hmm, something went wrong. I'll try again shortly!";
}
