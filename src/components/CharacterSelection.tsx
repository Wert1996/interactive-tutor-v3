import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useUser } from '../contexts/UserContext';
import apiService from '../services/apiService';
import type { Character, Session } from '../services/apiService';
import '../styles/CharacterSelection.css';

const CharacterSelection: React.FC = () => {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useUser();
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTeacher, setSelectedTeacher] = useState<string | null>(null);
  const [selectedClassmate, setSelectedClassmate] = useState<string | null>(null);
  const [creatingSession, setCreatingSession] = useState(false);
  // Carousel indices to show one character per role at a time
  const [teacherIndex, setTeacherIndex] = useState(0);
  const [classmateIndex, setClassmateIndex] = useState(0);

  useEffect(() => {
    const fetchCharacters = async () => {
      try {
        setLoading(true);
        const characterData = await apiService.getCharacters();
        setCharacters(characterData);
      } catch (err) {
        setError('Failed to load characters. Please try again later.');
        console.error('Error fetching characters:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchCharacters();
  }, []);

  const handleStartSession = async () => {
    if (!courseId || !selectedTeacher || !selectedClassmate) {
      alert('Please select a teacher and a classmate.');
      return;
    }

    if (!isAuthenticated || !user) {
      alert('Please sign in to start learning');
      navigate('/');
      return;
    }

    setCreatingSession(true);

    try {
      const sessionData: Session = await apiService.createSession({
        user_id: user.id,
        course_id: courseId,
        characters: [selectedTeacher, selectedClassmate],
      });

      localStorage.setItem(`session_${courseId}`, JSON.stringify(sessionData));
      navigate(`/course/${courseId}/learn`);
    } catch (err) {
      console.error('Error creating session:', err);
      alert('Failed to create learning session. Please try again.');
    } finally {
      setCreatingSession(false);
    }
  };

  const teachers = characters.filter((c) => c.role === 'teacher');
  const classmates = characters.filter((c) => c.role === 'classmate');

  const currentTeacher = teachers[teacherIndex] || null;
  const currentClassmate = classmates[classmateIndex] || null;

  const handleTeacherPrev = () => {
    if (teachers.length === 0) return;
    setTeacherIndex((prev) => (prev - 1 + teachers.length) % teachers.length);
  };

  const handleTeacherNext = () => {
    if (teachers.length === 0) return;
    setTeacherIndex((prev) => (prev + 1) % teachers.length);
  };

  const handleClassmatePrev = () => {
    if (classmates.length === 0) return;
    setClassmateIndex((prev) => (prev - 1 + classmates.length) % classmates.length);
  };

  const handleClassmateNext = () => {
    if (classmates.length === 0) return;
    setClassmateIndex((prev) => (prev + 1) % classmates.length);
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  if (error) {
    return <div>{error}</div>;
  }

  return (
    <div className="character-selection-container">
      <div className="character-selection-header">
        <h1>🎭 Select Your Learning Companions</h1>
        <p>Choose one teacher and one classmate for your personalized learning adventure</p>
      </div>

      <div className="character-selection-content">
        <div className="character-selection-main">
          <div className="character-section">
            <h2>👩‍🏫 Teachers</h2>
            <div className="character-carousel">
              <button
                className="nav-arrow left"
                onClick={handleTeacherPrev}
                disabled={teachers.length <= 1}
              >
                ‹
              </button>

              {currentTeacher && (
                <div
                  key={currentTeacher.name}
                  className={`character-card ${selectedTeacher === currentTeacher.name ? 'selected' : ''}`}
                  onClick={() => setSelectedTeacher(currentTeacher.name)}
                >
                  <img src={currentTeacher.image_url} alt={currentTeacher.name} />
                  <div className="character-info">
                    <h3>{currentTeacher.name}</h3>
                    <p><strong>Personality:</strong> {currentTeacher.personality}</p>
                    <p><strong>World:</strong> {currentTeacher.world_description}</p>
                  </div>
                </div>
              )}

              <button
                className="nav-arrow right"
                onClick={handleTeacherNext}
                disabled={teachers.length <= 1}
              >
                ›
              </button>
            </div>
          </div>

          <div className="character-section">
            <h2>👨‍🎓 Classmates</h2>
            <div className="character-carousel">
              <button
                className="nav-arrow left"
                onClick={handleClassmatePrev}
                disabled={classmates.length <= 1}
              >
                ‹
              </button>

              {currentClassmate && (
                <div
                  key={currentClassmate.name}
                  className={`character-card ${selectedClassmate === currentClassmate.name ? 'selected' : ''}`}
                  onClick={() => setSelectedClassmate(currentClassmate.name)}
                >
                  <img src={currentClassmate.image_url} alt={currentClassmate.name} />
                  <div className="character-info">
                    <h3>{currentClassmate.name}</h3>
                    <p><strong>Personality:</strong> {currentClassmate.personality}</p>
                    <p><strong>World:</strong> {currentClassmate.world_description}</p>
                  </div>
                </div>
              )}

              <button
                className="nav-arrow right"
                onClick={handleClassmateNext}
                disabled={classmates.length <= 1}
              >
                ›
              </button>
            </div>
          </div>
        </div>

        <div className="start-session-section">
          <div className="selection-status">
            <div className={`status-item ${selectedTeacher ? 'completed' : 'pending'}`}>
              {selectedTeacher ? '✓' : '○'} Teacher: {selectedTeacher || 'Not selected'}
            </div>
            <div className={`status-item ${selectedClassmate ? 'completed' : 'pending'}`}>
              {selectedClassmate ? '✓' : '○'} Classmate: {selectedClassmate || 'Not selected'}
            </div>
          </div>

          <button
            className="start-session-button"
            onClick={handleStartSession}
            disabled={!selectedTeacher || !selectedClassmate || creatingSession}
          >
            {creatingSession ? '🚀 Creating Session...' : '✨ Start Learning Adventure'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CharacterSelection;