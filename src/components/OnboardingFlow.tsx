import React, { useState } from 'react';
import type { OnboardingData } from '../services/apiService';
import '../styles/OnboardingFlow.css';

interface OnboardingFlowProps {
  onComplete: (data: OnboardingData) => void;
  onBack: () => void;
  userName: string;
  loading: boolean;
  error: string | null;
}

const OnboardingFlow: React.FC<OnboardingFlowProps> = ({
  onComplete,
  onBack,
  userName,
  loading,
  error,
}) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState<OnboardingData>({
    interests: [],
    hobbies: [],
    preferredAnalogies: [],
    age: 18,
  });

  const [interestText, setInterestText] = useState('');
  const [hobbyText, setHobbyText] = useState('');

  const interestOptions = [
    'Science', 'Mathematics', 'History', 'Literature', 'Arts', 'Music',
    'Technology', 'Sports', 'Languages', 'Philosophy', 'Psychology',
    'Business', 'Engineering', 'Medicine', 'Environmental Studies'
  ];

  const hobbyOptions = [
    'Reading', 'Writing', 'Drawing', 'Painting', 'Music', 'Sports',
    'Gaming', 'Cooking', 'Gardening', 'Photography', 'Travel',
    'Dancing', 'Hiking', 'Cycling', 'Swimming', 'Yoga'
  ];



  const analogyOptions = [
    'Sports analogies', 'Movie references', 'Everyday life examples',
    'Food comparisons', 'Nature metaphors', 'Technology analogies',
    'Historical examples', 'Pop culture references'
  ];

  const handleMultiSelect = (field: keyof OnboardingData, value: string) => {
    const currentValues = formData[field] as string[];
    if (currentValues.includes(value)) {
      setFormData({
        ...formData,
        [field]: currentValues.filter(item => item !== value)
      });
    } else {
      setFormData({
        ...formData,
        [field]: [...currentValues, value]
      });
    }
  };

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    } else {
      onBack();
    }
  };

  const handleSubmit = () => {
    // Process interests text into an array
    const processedInterests = interestText
      .split(',')
      .map(interest => interest.trim())
      .filter(interest => interest.length > 0);
    
    // Process hobbies text into an array
    const processedHobbies = hobbyText
      .split(',')
      .map(hobby => hobby.trim())
      .filter(hobby => hobby.length > 0);
    
    const finalData = {
      ...formData,
      interests: processedInterests,
      hobbies: processedHobbies
    };
    
    onComplete(finalData);
  };

  const steps = [
    {
      title: 'Tell us about your interests',
      content: (
        <div className="step-content">
          <p>What subjects, topics, or areas are you most interested in learning about? Tell us about your passions, curiosities, or anything you'd love to explore!</p>
          <div className="interest-input-section">
            <textarea
              value={interestText}
              onChange={(e) => setInterestText(e.target.value)}
              placeholder="Share your interests... For example: I'm fascinated by space exploration and astronomy, love understanding how the human brain works, enjoy learning about different cultures and languages, interested in sustainable technology and environmental science..."
              className="interest-textarea"
              rows={6}
            />
          </div>
          <div className="suggestions-section">
            <p className="suggestions-label">Need some inspiration? Here are some popular areas:</p>
            <div className="suggestion-tags">
              {interestOptions.map(interest => (
                <button
                  key={interest}
                  type="button"
                  className="suggestion-tag"
                  onClick={() => {
                    const currentText = interestText.trim();
                    const newText = currentText ? `${currentText}, ${interest}` : interest;
                    setInterestText(newText);
                  }}
                >
                  {interest}
                </button>
              ))}
            </div>
          </div>
        </div>
      )
    },
    {
      title: 'What are your hobbies?',
      content: (
        <div className="step-content">
          <p>What activities do you enjoy in your free time? Tell us about your hobbies, pastimes, or things you love to do!</p>
          <div className="interest-input-section">
            <textarea
              value={hobbyText}
              onChange={(e) => setHobbyText(e.target.value)}
              placeholder="Share your hobbies... For example: I love playing guitar and composing music, enjoy hiking and exploring nature trails, passionate about cooking and trying new recipes, love reading fantasy novels and sci-fi stories, enjoy photography and capturing moments..."
              className="interest-textarea"
              rows={6}
            />
          </div>
          <div className="suggestions-section">
            <p className="suggestions-label">Need some inspiration? Here are some popular hobbies:</p>
            <div className="suggestion-tags">
              {hobbyOptions.map(hobby => (
                <button
                  key={hobby}
                  type="button"
                  className="suggestion-tag"
                  onClick={() => {
                    const currentText = hobbyText.trim();
                    const newText = currentText ? `${currentText}, ${hobby}` : hobby;
                    setHobbyText(newText);
                  }}
                >
                  {hobby}
                </button>
              ))}
            </div>
          </div>
        </div>
      )
    },

    {
      title: 'How should we explain things?',
      content: (
        <div className="step-content">
          <p>What types of analogies and examples help you understand concepts better?</p>
          <div className="option-grid">
            {analogyOptions.map(analogy => (
              <button
                key={analogy}
                type="button"
                className={`option-button ${formData.preferredAnalogies.includes(analogy) ? 'selected' : ''}`}
                onClick={() => handleMultiSelect('preferredAnalogies', analogy)}
              >
                {analogy}
              </button>
            ))}
          </div>
        </div>
      )
    },
    {
      title: 'Almost done!',
      content: (
        <div className="step-content">
          <p>Finally, what's your age? This helps us adjust the complexity of explanations.</p>
          <div className="age-input">
            <input
              type="number"
              min="13"
              max="100"
              value={formData.age}
              onChange={(e) => setFormData({ ...formData, age: parseInt(e.target.value) || 18 })}
              className="age-field"
            />
          </div>
        </div>
      )
    }
  ];

  return (
    <div className="onboarding-modal-overlay">
      <div className="onboarding-modal">
        <div className="onboarding-header">
          <h2>Welcome, {userName}!</h2>
          <div className="progress-indicator">
            Step {currentStep + 1} of {steps.length}
          </div>
        </div>

        <div className="onboarding-body">
          {error && <div className="error-message">{error}</div>}
          
          <div className="step-container">
            <h3>{steps[currentStep].title}</h3>
            {steps[currentStep].content}
          </div>
        </div>

        <div className="onboarding-footer">
          <button 
            type="button"
            className="secondary-button"
            onClick={handlePrevious}
          >
            {currentStep === 0 ? 'Back' : 'Previous'}
          </button>
          
          {currentStep < steps.length - 1 ? (
            <button 
              type="button"
              className="primary-button"
              onClick={handleNext}
            >
              Next
            </button>
          ) : (
            <button 
              type="button"
              className="primary-button"
              onClick={handleSubmit}
              disabled={loading}
            >
              {loading ? 'Creating Account...' : 'Complete Setup'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default OnboardingFlow; 