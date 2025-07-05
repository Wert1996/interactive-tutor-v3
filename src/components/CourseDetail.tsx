import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import apiService from '../services/apiService';
import type { Course, Session } from '../services/apiService';
import '../styles/CourseDetail.css';

const CourseDetail: React.FC = () => {
  const { courseId } = useParams<{ courseId: string }>();
  const [course, setCourse] = useState<Course | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creatingSession, setCreatingSession] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchCourse = async () => {
      if (!courseId) {
        setError('Course ID is required');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const fetchedCourse = await apiService.getCourse(courseId);
        setCourse(fetchedCourse);
      } catch (err) {
        setError('Failed to load course details. Please try again later.');
        console.error('Error fetching course:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchCourse();
  }, [courseId]);

  const handleStartLearning = async () => {
    if (!courseId) {
      alert('Course ID is required');
      return;
    }

    setCreatingSession(true);
    
    try {
      console.log('Creating learning session for course:', courseId);
      
      // Create session via API
      const sessionData: Session = await apiService.createSession({
        user_id: 'user123', // TODO: Replace with actual user ID from auth
        course_id: courseId,
      });

      // Store session data in localStorage
      localStorage.setItem(`session_${courseId}`, JSON.stringify(sessionData));
      
      console.log('Session created successfully:', sessionData);
      
      // Navigate to learning screen
      navigate(`/course/${courseId}/learn`);
      
    } catch (err) {
      console.error('Error creating session:', err);
      alert('Failed to create learning session. Please try again.');
    } finally {
      setCreatingSession(false);
    }
  };

  const handleBackToGrid = () => {
    navigate('/');
  };

  if (loading) {
    return (
      <div className="course-detail-container">
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Loading course details...</p>
        </div>
      </div>
    );
  }

  if (error || !course) {
    return (
      <div className="course-detail-container">
        <div className="error-message">
          <h2>Oops! Something went wrong</h2>
          <p>{error || 'Course not found'}</p>
          <button onClick={handleBackToGrid} className="back-button">
            Back to Courses
          </button>
        </div>
      </div>
    );
  }

  const totalModules = course.topics.reduce((total, topic) => total + topic.modules.length, 0);

  return (
    <div className="course-detail-container">
      <div className="course-detail-header">
        <button onClick={handleBackToGrid} className="back-nav-button">
          ← Back to Courses
        </button>
        
        <div className="course-hero">
          <div className="course-hero-content">
            <span className="course-category-badge">{course.category}</span>
            <h1 className="course-title">{course.title}</h1>
            <p className="course-description">{course.description}</p>
            
            <div className="course-stats">
              <div className="stat-item">
                <span className="stat-icon">📚</span>
                <span className="stat-label">Topics</span>
                <span className="stat-value">{course.topics.length}</span>
              </div>
              <div className="stat-item">
                <span className="stat-icon">📖</span>
                <span className="stat-label">Modules</span>
                <span className="stat-value">{totalModules}</span>
              </div>
              <div className="stat-item">
                <span className="stat-icon">⏱️</span>
                <span className="stat-label">Duration</span>
                <span className="stat-value">{course.estimatedDuration}</span>
              </div>
            </div>
            
            <button 
              onClick={handleStartLearning} 
              className="start-learning-button" 
              disabled={creatingSession}
            >
              {creatingSession ? (
                <>
                  <span className="loading-spinner-small"></span>
                  Creating Session...
                </>
              ) : (
                <>
                  🚀 Start Learning
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="course-content">
        <h2 className="curriculum-title">Course Curriculum</h2>
        
        <div className="topics-list">
          {course.topics.map((topic, topicIndex) => (
            <div key={topicIndex} className="topic-card">
              <div className="topic-header">
                <h3 className="topic-title">
                  <span className="topic-number">{topicIndex + 1}</span>
                  {topic.title}
                </h3>
                <span className="module-count">{topic.modules.length} modules</span>
              </div>
              
              <p className="topic-description">{topic.description}</p>
              
              <div className="modules-list">
                {topic.modules.map((module, moduleIndex) => (
                  <div key={moduleIndex} className="module-item">
                    <div className="module-icon">📄</div>
                    <div className="module-content">
                      <h4 className="module-title">{module.title}</h4>
                      <p className="module-description">{module.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default CourseDetail; 