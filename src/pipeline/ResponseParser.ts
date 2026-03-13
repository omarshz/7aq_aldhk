import type { LLMResponse } from '../types/llm';
import type { Mood } from '../types/avatar';

const VALID_MOODS: Mood[] = ['happy', 'surprised', 'sad', 'angry', 'neutral', 'confused'];

/**
 * Parse an LLM response that *should* follow the format:
 *
 *   MOOD: <mood>
 *   COMMENT: <comment text, possibly spanning multiple lines>
 *
 * The parser is intentionally lenient:
 *   - Labels are matched case-insensitively.
 *   - COMMENT may span multiple lines -- everything after the label until the
 *     end of the string (or the next known label) is captured.
 *   - If the LLM ignores the format entirely the whole string is used as the
 *     comment and mood defaults to "neutral".
 *   - Mood synonyms / close matches are mapped to valid moods.
 */
export function parseResponse(raw: string): LLMResponse {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { mood: 'neutral', comment: "I'm not sure what to say!" };
  }

  // --- mood ----------------------------------------------------------------
  let mood: Mood = 'neutral';
  const moodMatch = trimmed.match(/mood\s*[:=]\s*(\w+)/i);
  if (moodMatch) {
    mood = normalizeMood(moodMatch[1]);
  }

  // --- comment -------------------------------------------------------------
  // Try to grab everything after "COMMENT:" (case-insensitive) to end of string.
  // Use [\s\S] instead of . so that newlines are included.
  const commentMatch = trimmed.match(/comment\s*[:=]\s*([\s\S]+)/i);

  let comment: string;
  if (commentMatch) {
    comment = commentMatch[1].trim();
  } else if (moodMatch) {
    // The LLM provided a MOOD label but no COMMENT label.
    // Take everything that is NOT part of the MOOD line.
    comment = trimmed
      .replace(/mood\s*[:=]\s*\w+/i, '')
      .trim() || "I'm not sure what to say!";
  } else {
    // No recognised labels at all -- treat the entire output as the comment.
    comment = trimmed;
  }

  // Collapse excessive whitespace / newlines into single spaces so the speech
  // bubble does not look odd.
  comment = comment.replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();

  if (!comment) {
    comment = "I'm not sure what to say!";
  }

  return { mood, comment };
}

/** Map a raw mood string to a valid Mood, handling synonyms and typos. */
function normalizeMood(raw: string): Mood {
  const lower = raw.toLowerCase().trim();

  // Exact match
  if ((VALID_MOODS as string[]).includes(lower)) {
    return lower as Mood;
  }

  // Common synonyms / close matches
  const synonyms: Record<string, Mood> = {
    excitement: 'happy',
    excited: 'happy',
    joy: 'happy',
    joyful: 'happy',
    cheerful: 'happy',
    amused: 'happy',
    content: 'happy',
    curious: 'surprised',
    shocked: 'surprised',
    amazed: 'surprised',
    intrigued: 'surprised',
    upset: 'sad',
    unhappy: 'sad',
    melancholy: 'sad',
    disappointed: 'sad',
    frustrated: 'angry',
    annoyed: 'angry',
    irritated: 'angry',
    mad: 'angry',
    calm: 'neutral',
    bored: 'neutral',
    indifferent: 'neutral',
    puzzled: 'confused',
    bewildered: 'confused',
    perplexed: 'confused',
    unsure: 'confused',
  };

  if (synonyms[lower]) {
    return synonyms[lower];
  }

  // Fuzzy prefix match (e.g. "happ" -> "happy")
  for (const valid of VALID_MOODS) {
    if (lower.startsWith(valid.slice(0, 3)) || valid.startsWith(lower.slice(0, 3))) {
      return valid;
    }
  }

  return 'neutral';
}
