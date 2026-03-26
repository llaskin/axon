import { describe, it, expect } from 'vitest';
import { parseHistoryFile, getPromptsForSession } from './promptTimeline';

const SAMPLE_JSONL = [
  '{"display":"prompt 1","pastedContents":{"file.ts":"code"},"timestamp":1000,"project":"/home","sessionId":"sess-1"}',
  '{"display":"prompt 2","pastedContents":{},"timestamp":2000,"project":"/home","sessionId":"sess-1"}',
  '{"display":"prompt 3","pastedContents":{},"timestamp":3000,"project":"/work","sessionId":"sess-2"}',
].join('\n');

const JSONL_WITH_SECRET = [
  '{"display":"my key is sk-ant-api03-abc123","pastedContents":{},"timestamp":1000,"project":"/home","sessionId":"sess-3"}',
].join('\n');

describe('parseHistoryFile', () => {
  it('parses valid JSONL into session map', () => {
    const map = parseHistoryFile(SAMPLE_JSONL);
    expect(map.get('sess-1')).toHaveLength(2);
    expect(map.get('sess-2')).toHaveLength(1);
  });

  it('strips pastedContents from entries', () => {
    const map = parseHistoryFile(SAMPLE_JSONL);
    const entries = map.get('sess-1')!;
    // PromptEntry only has display + timestamp — no pastedContents
    expect(Object.keys(entries[0])).toEqual(['display', 'timestamp']);
  });

  it('applies redaction to display text', () => {
    const map = parseHistoryFile(JSONL_WITH_SECRET);
    const entries = map.get('sess-3')!;
    expect(entries[0].display).toBe('my key is [REDACTED_API_KEY]');
  });

  it('skips lines with missing required fields', () => {
    const bad =
      '{"display":"no session","timestamp":1000}\n{"display":"good","timestamp":2000,"sessionId":"s1","project":"/x"}';
    const map = parseHistoryFile(bad);
    expect(map.size).toBe(1);
    expect(map.get('s1')).toHaveLength(1);
  });

  it('handles empty input', () => {
    expect(parseHistoryFile('').size).toBe(0);
  });

  it('handles malformed JSON lines gracefully', () => {
    const bad =
      'not json\n{"display":"ok","timestamp":1000,"sessionId":"s1","project":"/x"}';
    const map = parseHistoryFile(bad);
    expect(map.get('s1')).toHaveLength(1);
  });

  it('sorts prompts by timestamp within each session', () => {
    const reversed = [
      '{"display":"later","timestamp":5000,"sessionId":"s1","project":"/x"}',
      '{"display":"earlier","timestamp":1000,"sessionId":"s1","project":"/x"}',
    ].join('\n');
    const map = parseHistoryFile(reversed);
    const prompts = map.get('s1')!;
    expect(prompts[0].timestamp).toBe(1000);
    expect(prompts[1].timestamp).toBe(5000);
  });
});

describe('getPromptsForSession', () => {
  it('returns prompts for a known session', () => {
    const map = parseHistoryFile(SAMPLE_JSONL);
    const prompts = getPromptsForSession(map, 'sess-1');
    expect(prompts).toHaveLength(2);
    expect(prompts[0].timestamp).toBe(1000);
  });

  it('returns empty array for unknown session', () => {
    const map = parseHistoryFile(SAMPLE_JSONL);
    expect(getPromptsForSession(map, 'nonexistent')).toEqual([]);
  });
});
