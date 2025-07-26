import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../contexts/UserContext';
import apiService from '../services/apiService';
import type { Course } from '../services/apiService';
import AuthModal from './AuthModal';
import '../styles/CourseGrid.css';

const CourseGrid: React.FC = () => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const { user, isAuthenticated, logout } = useUser();
  const navigate = useNavigate();

  useEffect(() => {
    const fetchCourses = async () => {
      try {
        setLoading(true);
        const fetchedCourses = await apiService.listCourses();
        setCourses(fetchedCourses);
      } catch (err) {
        setError('Failed to load courses. Please try again later.');
        console.error('Error fetching courses:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchCourses();
  }, []);

  const handleCourseClick = (courseId: string) => {
    if (!isAuthenticated) {
      setShowAuthModal(true);
      return;
    }
    navigate(`/course/${courseId}`);
  };

  const handleSignOut = () => {
    logout();
  };

  if (loading) {
    return (
      <div className="course-grid-container">
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Loading courses...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="course-grid-container">
        <div className="error-message">
          <h2>Oops! Something went wrong</h2>
          <p>{error}</p>
          <button onClick={() => window.location.reload()} className="retry-button">
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="course-grid-container">
      <header className="course-grid-header">
        <div className="header-content">
          <div className="header-left">
            <h1>Welcome to Koru</h1>
            <p>Where learning becomes an adventure. Explore personalized courses with AI tutors who adapt to your pace.</p>
          </div>
          <div className="header-right">
            {isAuthenticated ? (
              <div className="user-info">
                <span className="welcome-text">Welcome, {user?.name}!</span>
                <button 
                  onClick={() => navigate(`/dashboard/${user?.id}`)} 
                  className="dashboard-button"
                >
                  📊 Dashboard
                </button>
                <button onClick={handleSignOut} className="sign-out-button">
                  Sign Out
                </button>
              </div>
            ) : (
              <button 
                onClick={() => setShowAuthModal(true)} 
                className="sign-in-button"
              >
                Sign In / Sign Up
              </button>
            )}
          </div>
        </div>
      </header>
      
      <div className="courses-grid">
        {courses.map((course) => (
          <div
            key={course.id}
            className="course-card"
            onClick={() => handleCourseClick(course.id)}
          >
            <div className="course-card-header">
              <h3 className="course-title">{course.title}</h3>
              <span className="course-category">{course.category}</span>
            </div>
            
            <div className="course-card-body">
              <p className="course-description">{course.description}</p>
              
              <div className="course-meta">
                <div className="course-stat">
                  <span className="stat-icon">📚</span>
                  <span className="stat-text">{course.topics.length} Topics</span>
                </div>
                <div className="course-stat">
                  <span className="stat-icon">⏱️</span>
                  <span className="stat-text">{course.estimatedDuration}</span>
                </div>
              </div>
            </div>
            
            <div className="course-card-footer">
              <button className="start-course-btn">
                {isAuthenticated ? 'Explore Course' : 'Sign In to Start'}
              </button>
            </div>
          </div>
        ))}
      </div>
      
      {courses.length === 0 && (
        <div className="empty-state">
          <h2>No courses available</h2>
          <p>Check back later for new courses!</p>
        </div>
      )}

      <AuthModal 
        isOpen={showAuthModal} 
        onClose={() => setShowAuthModal(false)} 
      />
    </div>
  );
};

export default CourseGrid; 