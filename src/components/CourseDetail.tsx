import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useUser } from '../contexts/UserContext';
import apiService from '../services/apiService';
import type { Course, Session } from '../services/apiService';
import '../styles/CourseDetail.css';

const CourseDetail: React.FC = () => {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useUser();
  const [course, setCourse] = useState<Course | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creatingSession, setCreatingSession] = useState(false);

  useEffect(() => {
    const fetchCourse = async () => {
      if (!courseId) {
        setError('Course ID is required');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const courseData = await apiService.getCourse(courseId);
        setCourse(courseData);
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

    if (!isAuthenticated || !user) {
      alert('Please sign in to start learning');
      navigate('/');
      return;
    }

    navigate(`/course/${courseId}/character-selection`);
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
              disabled={creatingSession || !isAuthenticated}
            >
              {creatingSession ? (
                <>
                  <span className="loading-spinner-small"></span>
                  Creating Session...
                </>
              ) : !isAuthenticated ? (
                'Please Sign In to Start Learning'
              ) : (
                <>
                  🚀 Start Learning
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="course-detail-content">
        <div className="course-outline">
          <h2>Course Outline</h2>
          <div className="topics-list">
            {course.topics.map((topic, topicIndex) => (
              <div key={topicIndex} className="topic-item">
                <h3 className="topic-title">{topic.title}</h3>
                <p className="topic-description">{topic.description}</p>
                <div className="modules-list">
                  {topic.modules.map((module, moduleIndex) => (
                    <div key={moduleIndex} className="module-item">
                      <div className="module-header">
                        <span className="module-icon">📖</span>
                        <h4 className="module-title">{module.title}</h4>
                      </div>
                      <p className="module-description">{module.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CourseDetail; 