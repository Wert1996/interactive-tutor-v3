import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import apiService from '../services/apiService';
import type { Course } from '../services/apiService';
import '../styles/CourseGrid.css';

const CourseGrid: React.FC = () => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
    navigate(`/course/${courseId}`);
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
        <h1>Interactive Learning Hub</h1>
        <p>Discover amazing courses to enhance your skills</p>
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
                Explore Course
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
    </div>
  );
};

export default CourseGrid; 