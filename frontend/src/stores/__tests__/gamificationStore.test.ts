import { describe, it, expect, beforeEach } from 'vitest';
import { useGamificationStore } from '../gamificationStore';

beforeEach(() => {
  useGamificationStore.setState({ xp: null, achievementsCount: null, latestAchievements: null });
});

describe('gamificationStore', () => {
  it('starts with null values', () => {
    const state = useGamificationStore.getState();
    expect(state.xp).toBeNull();
    expect(state.achievementsCount).toBeNull();
    expect(state.latestAchievements).toBeNull();
  });

  it('reset clears all fields', () => {
    useGamificationStore.setState({ xp: 500, achievementsCount: 10, latestAchievements: [] });
    useGamificationStore.getState().reset();
    const state = useGamificationStore.getState();
    expect(state.xp).toBeNull();
    expect(state.achievementsCount).toBeNull();
    expect(state.latestAchievements).toBeNull();
  });
});
