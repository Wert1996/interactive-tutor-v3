import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import '../styles/LearningScreen.css';

// Import character images
import teacherImage from '../assets/characters/teacher.webp';
import classmateImage from '../assets/characters/classmate.jpg';
import studentImage from '../assets/characters/student.jpeg';

interface SessionData {
  id: string;
  user_id: string;
  course_id: string;
  created_at: string;
  status: string;
  progress: {
    topic_id: string;
    module_id: string;
    phase_id: number;
  };
}

interface MCQOption {
  text: string;
  correct: boolean;
}

interface MCQQuestion {
  question: string;
  options: MCQOption[];
}

interface BinaryChoiceQuestion {
  question: string;
  left: string;
  right: string;
  correct: 'left' | 'right';
}

interface CommandMessage {
  type: 'command';
  command: {
    command_type: string;
    payload: any;
  };
}

const LearningScreen: React.FC = () => {
  const { courseId } = useParams<{ courseId: string }>();
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
  const [sessionData, setSessionData] = useState<SessionData | null>(null);
  const [whiteboardContent, setWhiteboardContent] = useState<string>('');
  const [currentQuestion, setCurrentQuestion] = useState<MCQQuestion | null>(null);
  const [currentBinaryQuestion, setCurrentBinaryQuestion] = useState<BinaryChoiceQuestion | null>(null);
  const [showFinishButton, setShowFinishButton] = useState<boolean>(false);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [selectedBinaryChoice, setSelectedBinaryChoice] = useState<'left' | 'right' | null>(null);
  const [showFeedback, setShowFeedback] = useState<boolean>(false);
  const [feedbackCorrect, setFeedbackCorrect] = useState<boolean>(false);
  
  // Audio recording states
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isAudioPlaying, setIsAudioPlaying] = useState<boolean>(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  
  // Sequential processing state
  const [commandQueue, setCommandQueue] = useState<CommandMessage[]>([]);
  const [shouldProcessNext, setShouldProcessNext] = useState<boolean>(false);
  
  // Speaking states for characters
  const [speakingStates, setSpeakingStates] = useState<{
    teacher: boolean;
    classmate: boolean;
    student: boolean;
  }>({
    teacher: false,
    classmate: false,
    student: false
  });
  
  const websocketRef = useRef<WebSocket | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const completionCallbackRef = useRef<(() => void) | null>(null);
  const isProcessingRef = useRef<boolean>(false);  // Synchronous processing state
  const audioChunksRef = useRef<Blob[]>([]);  // Use ref for audio chunks to avoid stale closure issues

  // Effect to handle queue processing
  useEffect(() => {
    if (shouldProcessNext && commandQueue.length > 0 && !isProcessingRef.current) {
      const [nextCommand, ...remainingQueue] = commandQueue;
      setCommandQueue(remainingQueue);
      setShouldProcessNext(false);
      isProcessingRef.current = true;
      processCommand(nextCommand);
    } else if (commandQueue.length === 0 && shouldProcessNext) {
      setShouldProcessNext(false);
      isProcessingRef.current = false;
    }
  }, [commandQueue, shouldProcessNext]);

  // Mark current command as complete and process next
  const markCommandComplete = () => {
    completionCallbackRef.current = null;
    isProcessingRef.current = false;
    setShouldProcessNext(true);
  };

  // Process a single command
  const processCommand = (message: CommandMessage) => {
    const { command_type, payload } = message.command;
    console.log('Processing command:', command_type);
    
    switch (command_type) {
      case 'TEACHER_SPEECH':
        // Set teacher as speaking
        setSpeakingStates(prev => ({ ...prev, teacher: true }));
        
        if (payload.audio_bytes) {
          playAudioWithCallback(payload.audio_bytes);
        } else {
          markCommandComplete();
        }
        break;
        
      case 'CLASSMATE_SPEECH':
        // Set classmate as speaking
        setSpeakingStates(prev => ({ ...prev, classmate: true }));
        
        if (payload.audio_bytes) {
          // Wait 3 seconds before classmate speaks
          setTimeout(() => {
            playAudioWithCallback(payload.audio_bytes);
          }, 1000);
        } else {
          markCommandComplete();
        }
        break;
        
      case 'WHITEBOARD':
        if (payload.html) {
          setWhiteboardContent(prev => prev + payload.html);
          // Small delay to ensure rendering
          setTimeout(() => {
            markCommandComplete();
          }, 100);
        } else {
          markCommandComplete();
        }
        break;
        
      case 'MCQ_QUESTION':
        if (payload.question && payload.options) {
          setCurrentQuestion({
            question: payload.question,
            options: payload.options
          });
          setSelectedOption(null);
          // Completion will be handled by submitAnswer or cancel
        } else {
          markCommandComplete();
        }
        break;
        
      case 'BINARY_CHOICE_QUESTION':
        if (payload.question && payload.left && payload.right && payload.correct) {
          setCurrentBinaryQuestion({
            question: payload.question,
            left: payload.left,
            right: payload.right,
            correct: payload.correct
          });
          setSelectedBinaryChoice(null);
          // Completion will be handled by submitBinaryAnswer or cancelBinaryQuestion
        } else {
          markCommandComplete();
        }
        break;
        
      case 'FINISH_MODULE':
        setShowFinishButton(true);
        // Mark command as complete immediately so other commands can be processed
        // The button will remain visible until user clicks it
        markCommandComplete();
        break;
        
      default:
        console.log('Unknown command type:', command_type);
        markCommandComplete();
        break;
    }
  };

  // Function to play base64 encoded audio with completion callback
  const playAudioWithCallback = (audioBytes: string) => {
    try {
      const audioBlob = new Blob([Uint8Array.from(atob(audioBytes), c => c.charCodeAt(0))], { type: 'audio/wav' });
      const audioUrl = URL.createObjectURL(audioBlob);
      
      if (audioRef.current) {
        audioRef.current.src = audioUrl;
        
        // Set audio playing state
        setIsAudioPlaying(true);
        
        // Set up completion callback
        const handleAudioEnd = () => {
          audioRef.current?.removeEventListener('ended', handleAudioEnd);
          audioRef.current?.removeEventListener('error', handleAudioError);
          URL.revokeObjectURL(audioUrl);
          setIsAudioPlaying(false);
          
          // Clear all speaking states when audio ends
          setSpeakingStates({
            teacher: false,
            classmate: false,
            student: false
          });
          
          markCommandComplete();
        };
        
        const handleAudioError = (error: any) => {
          console.error('Audio playback error:', error);
          audioRef.current?.removeEventListener('ended', handleAudioEnd);
          audioRef.current?.removeEventListener('error', handleAudioError);
          URL.revokeObjectURL(audioUrl);
          setIsAudioPlaying(false);
          
          // Clear all speaking states on error
          setSpeakingStates({
            teacher: false,
            classmate: false,
            student: false
          });
          
          markCommandComplete();
        };
        
        audioRef.current.addEventListener('ended', handleAudioEnd);
        audioRef.current.addEventListener('error', handleAudioError);
        
        audioRef.current.play().catch(error => {
          console.error('Error starting audio playback:', error);
          handleAudioError(error);
        });
      }
    } catch (error) {
      console.error('Error processing audio:', error);
      markCommandComplete();
    }
  };

  // Start audio recording
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      
      recorder.onstop = () => {
        stream.getTracks().forEach(track => track.stop());
        setIsRecording(false);
        // Clear student speaking state when recording stops
        setSpeakingStates(prev => ({ ...prev, student: false }));
      };
      
      setMediaRecorder(recorder);
      audioChunksRef.current = [];
      recorder.start();
      setIsRecording(true);
      
      // Set student as speaking when recording starts
      setSpeakingStates(prev => ({ ...prev, student: true }));
    } catch (error) {
      console.error('Error starting recording:', error);
      alert('Error accessing microphone. Please check permissions.');
    }
  };

  // Stop audio recording and send to WebSocket
  const stopRecording = () => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
      
      // Process audio chunks after recording stops
      mediaRecorder.addEventListener('stop', () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        
        // Convert blob to base64
        const reader = new FileReader();
        reader.onload = () => {
          const base64Audio = reader.result as string;
          const audioBytes = base64Audio.split(',')[1]; // Remove data URL prefix
          
          // Send to WebSocket
          if (websocketRef.current && sessionData?.id) {
            const studentInteractionMessage = {
              type: "student_interaction",
              interaction: {
                type: "speech",
                audio_bytes: audioBytes
              },
              session_id: sessionData.id
            };
            console.log('Sending student speech interaction:', studentInteractionMessage);
            websocketRef.current.send(JSON.stringify(studentInteractionMessage));
          }
        };
        reader.readAsDataURL(audioBlob);
        
        audioChunksRef.current = [];
      }, { once: true });
    }
  };

  // Toggle recording
  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  // Handle MCQ option selection
  const handleOptionSelect = (optionIndex: number) => {
    setSelectedOption(optionIndex);
  };

  // Submit MCQ answer
  const submitAnswer = () => {
    if (selectedOption !== null && currentQuestion) {
      const isCorrect = currentQuestion.options[selectedOption].correct;
      
      // Send student interaction message to WebSocket
      if (websocketRef.current) {
        const studentInteractionMessage = {
          type: "student_interaction",
          interaction: {
            type: "mcq_question",
            answer: selectedOption,
            correct: isCorrect
          },
          session_id: sessionData?.id
        };
        websocketRef.current.send(JSON.stringify(studentInteractionMessage));
      }
      
      // Show feedback before closing the question popup
      setShowFeedback(true);
      setFeedbackCorrect(isCorrect);
      
      // If correct, show feedback for 2 seconds, then close
      // If incorrect, user needs to manually close
      if (isCorrect) {
        setTimeout(() => {
          setCurrentQuestion(null);
          setSelectedOption(null);
          setShowFeedback(false);
          setFeedbackCorrect(false);
          markCommandComplete();
        }, 2000);
      }
    }
  };

  // Cancel MCQ question
  const cancelQuestion = () => {
    setCurrentQuestion(null);
    setSelectedOption(null);
    setShowFeedback(false);
    setFeedbackCorrect(false);
    markCommandComplete();
  };

  // Handle Binary Choice selection
  const handleBinaryChoiceSelect = (choice: 'left' | 'right') => {
    setSelectedBinaryChoice(choice);
  };

  // Submit Binary Choice answer
  const submitBinaryAnswer = () => {
    if (selectedBinaryChoice !== null && currentBinaryQuestion) {
      const isCorrect = selectedBinaryChoice === currentBinaryQuestion.correct;
      
      // Send student interaction message to WebSocket
      if (websocketRef.current) {
        const studentInteractionMessage = {
          type: "student_interaction",
          interaction: {
            type: "binary_choice_question",
            answer: selectedBinaryChoice,
            correct: isCorrect
          },
          session_id: sessionData?.id
        };
        websocketRef.current.send(JSON.stringify(studentInteractionMessage));
      }
      
      // Show feedback before closing the question popup
      setShowFeedback(true);
      setFeedbackCorrect(isCorrect);
      
      // If correct, show feedback for 2 seconds, then close
      // If incorrect, user needs to manually close
      if (isCorrect) {
        setTimeout(() => {
          setCurrentBinaryQuestion(null);
          setSelectedBinaryChoice(null);
          setShowFeedback(false);
          setFeedbackCorrect(false);
          markCommandComplete();
        }, 2000);
      }
    }
  };

  // Cancel Binary Choice question
  const cancelBinaryQuestion = () => {
    setCurrentBinaryQuestion(null);
    setSelectedBinaryChoice(null);
    setShowFeedback(false);
    setFeedbackCorrect(false);
    markCommandComplete();
  };

  // Handle continue lesson button click
  const handleContinueLesson = () => {
    // Clear whiteboard and reset states BEFORE sending WebSocket message
    // to avoid race condition with incoming responses
    setWhiteboardContent('');
    setCurrentQuestion(null);
    setCurrentBinaryQuestion(null);
    setSelectedOption(null);
    setSelectedBinaryChoice(null);
    setShowFinishButton(false);
    setShowFeedback(false);
    setFeedbackCorrect(false);
    
    // Send next_phase message to WebSocket
    if (websocketRef.current && sessionData?.id) {
      const nextPhaseMessage = {
        type: "next_phase",
        session_id: sessionData.id
      };
      websocketRef.current.send(JSON.stringify(nextPhaseMessage));
    }
    
    // No need to call markCommandComplete() here since FINISH_MODULE 
    // command was already marked complete when the button was shown
  };

  // Add command to queue or process immediately
  const handleCommandMessage = (message: CommandMessage) => {
    if (isProcessingRef.current) {
      // Add to queue if currently processing
      setCommandQueue(prevQueue => [...prevQueue, message]);
    } else {
      // Process immediately if not processing
      isProcessingRef.current = true;
      processCommand(message);
    }
  };

  // Message handler for WebSocket messages
  const handleWebSocketMessage = (messages: any[]) => {
    messages.forEach((message) => {
      console.log('WebSocket message type:', message.type);
      
      switch (message.type) {
        case 'pong':
          setConnectionStatus('connected');
          
          // Start session after successful connection using existing session ID
          if (sessionData?.id) {
            const startSessionMessage = {
              type: "start_session",
              session_id: sessionData.id
            };
            
            if (websocketRef.current) {
              websocketRef.current.send(JSON.stringify(startSessionMessage));
            }
          } else {
            console.error('No session data available to start session');
          }
          break;
          
        case 'session_started':
          break;
          
        case 'session_error':
          console.error('Session error:', message);
          break;
          
        case 'learning_content':
          break;
          
        case 'command':
          // Handle command messages with sequential processing
          if (message.command && message.command.command_type && message.command.payload) {
            handleCommandMessage(message as CommandMessage);
          } else {
            console.error('Invalid command message structure:', message);
          }
          break;
          
        default:
          console.log('Unknown message type:', message.type);
          break;
      }
    });
  };

  useEffect(() => {
    if (courseId) {
      // Retrieve session data from localStorage
      const storedSession = localStorage.getItem(`session_${courseId}`);
      if (storedSession) {
        try {
          const parsedSession = JSON.parse(storedSession);
          setSessionData(parsedSession);
        } catch (error) {
          console.error('Error parsing session data:', error);
        }
      } else {
        console.error('No session data found for courseId:', courseId);
      }
    }
  }, [courseId]);

  useEffect(() => {
    if (sessionData) {
      // Connect to WebSocket only after session data is loaded
      const websocketUrl = 'ws://localhost:8000/learning-interface';
      setConnectionStatus('connecting');
      
      const ws = new WebSocket(websocketUrl);
      websocketRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connected');
        // Send ping to verify connection
        ws.send(JSON.stringify({ type: "ping" }));
      };

      ws.onclose = (event) => {
        console.log('WebSocket disconnected');
        setConnectionStatus('disconnected');
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setConnectionStatus('disconnected');
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          // Check if data is an array
          if (Array.isArray(data)) {
            handleWebSocketMessage(data);
          } else {
            // Handle single message (fallback)
            handleWebSocketMessage([data]);
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      // Cleanup function
      return () => {
        if (websocketRef.current) {
          websocketRef.current.close();
        }
      };
    }
  }, [sessionData]);

  const getConnectionStatusColor = () => {
    switch (connectionStatus) {
      case 'connected':
        return '#22c55e'; // green
      case 'connecting':
        return '#f59e0b'; // yellow
      case 'disconnected':
        return '#ef4444'; // red
      default:
        return '#6b7280'; // gray
    }
  };

  const getConnectionStatusText = () => {
    switch (connectionStatus) {
      case 'connected':
        return sessionData?.id ? `Connected (${sessionData.id})` : 'Connected';
      case 'connecting':
        return 'Connecting...';
      case 'disconnected':
        return 'Disconnected';
      default:
        return 'Unknown';
    }
  };

  return (
    <div style={{ 
      minHeight: '100vh', 
      backgroundColor: 'white',
      padding: '20px'
    }}>
      {/* Connection Status */}
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: '20px'
      }}>
        <div className="connection-indicator">
          <div 
            className="connection-status"
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '8px',
              padding: '12px 24px',
              borderRadius: '25px',
              backgroundColor: '#f8f9fa',
              fontSize: '16px',
              fontWeight: '500',
              border: '1px solid #e9ecef',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              color: '#333'
            }}
          >
            <div 
              className="connection-dot"
              style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                backgroundColor: getConnectionStatusColor(),
              }}
            />
            <span>{getConnectionStatusText()}</span>
          </div>
        </div>
      </div>

      {/* Hidden Audio Element */}
      <audio ref={audioRef} style={{ display: 'none' }} />

      {/* Main Content Area */}
      <div style={{
        display: 'flex',
        gap: '20px',
        alignItems: 'flex-start'
      }}>
        {/* Characters Panel */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '15px',
          minWidth: '150px'
        }}>
          {/* Teacher */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px'
          }}>
            <div 
              className={speakingStates.teacher ? 'speaking-teacher' : ''}
              style={{
                width: '150px',
                height: '150px',
                border: `4px solid ${speakingStates.teacher ? '#28a745' : '#e9ecef'}`,
                borderRadius: '12px',
                overflow: 'hidden',
                boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                transition: 'border-color 0.3s ease'
              }}
            >
              <img 
                src={teacherImage} 
                alt="Teacher"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover'
                }}
              />
            </div>
            <span style={{
              fontSize: '14px',
              fontWeight: '600',
              color: '#333',
              textAlign: 'center'
            }}>
              Ms. Milie
            </span>
          </div>
          
          {/* Student */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px'
          }}>
            <div 
              className={speakingStates.student ? 'speaking-student' : ''}
              style={{
                width: '150px',
                height: '150px',
                border: `4px solid ${speakingStates.student ? '#007bff' : '#e9ecef'}`,
                borderRadius: '12px',
                overflow: 'hidden',
                boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                transition: 'border-color 0.3s ease'
              }}
            >
              <img 
                src={studentImage} 
                alt="Student"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover'
                }}
              />
            </div>
            <span style={{
              fontSize: '14px',
              fontWeight: '600',
              color: '#333',
              textAlign: 'center'
            }}>
              You
            </span>
          </div>
          
          {/* Classmate */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px'
          }}>
            <div 
              className={speakingStates.classmate ? 'speaking-classmate' : ''}
              style={{
                width: '150px',
                height: '150px',
                border: `4px solid ${speakingStates.classmate ? '#ffc107' : '#e9ecef'}`,
                borderRadius: '12px',
                overflow: 'hidden',
                boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                transition: 'border-color 0.3s ease'
              }}
            >
              <img 
                src={classmateImage} 
                alt="Classmate"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover'
                }}
              />
            </div>
            <span style={{
              fontSize: '14px',
              fontWeight: '600',
              color: '#333',
              textAlign: 'center'
            }}>
              Sam
            </span>
          </div>
        </div>

        {/* Whiteboard */}
        <div className="whiteboard-container" style={{
          backgroundColor: '#ffffff',
          border: '2px solid #e9ecef',
          borderRadius: '10px',
          padding: '20px',
          minHeight: '70vh',
          flex: 1,
          boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
          overflow: 'auto'
        }}>
          <h2 style={{ 
            marginTop: '0', 
            marginBottom: '20px',
            color: '#333',
            borderBottom: '2px solid #f8f9fa',
            paddingBottom: '10px'
          }}>
            Whiteboard
          </h2>
          <div 
            className="whiteboard-content"
            dangerouslySetInnerHTML={{ __html: whiteboardContent }}
            style={{
              lineHeight: '1.6',
              fontSize: '16px',
              color: '#444'
            }}
          />
          {!whiteboardContent && (
            <p style={{ 
              color: '#6c757d', 
              fontStyle: 'italic',
              textAlign: 'center',
              marginTop: '50px'
            }}>
              Whiteboard content will appear here...
            </p>
          )}
        </div>
      </div>

      {/* Finish Module Button */}
      {showFinishButton && (
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          marginTop: '20px'
        }}>
          <button
            onClick={handleContinueLesson}
            style={{
              padding: '15px 30px',
              backgroundColor: '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '18px',
              fontWeight: '600',
              cursor: 'pointer',
              boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
              transition: 'all 0.3s ease'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.backgroundColor = '#218838';
              e.currentTarget.style.transform = 'translateY(-2px)';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.backgroundColor = '#28a745';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            Continue Lesson
          </button>
        </div>
      )}

      {/* Interact Button */}
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        marginTop: '20px'
      }}>
        <button
          onClick={toggleRecording}
          disabled={isAudioPlaying}
          style={{
            padding: '15px 30px',
            backgroundColor: isRecording ? '#dc3545' : (isAudioPlaying ? '#6c757d' : '#007bff'),
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            fontSize: '18px',
            fontWeight: '600',
            cursor: isAudioPlaying ? 'not-allowed' : 'pointer',
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
            transition: 'all 0.3s ease',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            opacity: isAudioPlaying ? 0.6 : 1
          }}
          onMouseOver={(e) => {
            if (!isAudioPlaying) {
              if (isRecording) {
                e.currentTarget.style.backgroundColor = '#c82333';
              } else {
                e.currentTarget.style.backgroundColor = '#0056b3';
              }
              e.currentTarget.style.transform = 'translateY(-2px)';
            }
          }}
          onMouseOut={(e) => {
            if (!isAudioPlaying) {
              if (isRecording) {
                e.currentTarget.style.backgroundColor = '#dc3545';
              } else {
                e.currentTarget.style.backgroundColor = '#007bff';
              }
              e.currentTarget.style.transform = 'translateY(0)';
            }
          }}
        >
          <span style={{
            fontSize: '20px',
            animation: isRecording ? 'pulse 1s infinite' : 'none'
          }}>
            🎤
          </span>
          {isRecording ? 'Stop Recording' : (isAudioPlaying ? 'Audio Playing...' : 'Interact')}
        </button>
      </div>

      {/* Add CSS for animations */}
      <style>{`
        @keyframes pulse {
          0% { opacity: 1; }
          50% { opacity: 0.5; }
          100% { opacity: 1; }
        }
        
        @keyframes speaking-blink-teacher {
          0% { border-color: #28a745; }
          50% { border-color: transparent; }
          100% { border-color: #28a745; }
        }
        
        @keyframes speaking-blink-student {
          0% { border-color: #007bff; }
          50% { border-color: transparent; }
          100% { border-color: #007bff; }
        }
        
        @keyframes speaking-blink-classmate {
          0% { border-color: #ffc107; }
          50% { border-color: transparent; }
          100% { border-color: #ffc107; }
        }
        
        .speaking-teacher {
          animation: speaking-blink-teacher 1s infinite;
        }
        
        .speaking-student {
          animation: speaking-blink-student 1s infinite;
        }
        
        .speaking-classmate {
          animation: speaking-blink-classmate 1s infinite;
        }
      `}</style>

      {/* MCQ Question Popup */}
      {currentQuestion && !showFeedback && (
        <div className="question-popup-overlay" style={{
          position: 'fixed',
          top: '0',
          left: '0',
          right: '0',
          bottom: '0',
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: '1000'
        }}>
          <div className="question-popup" style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '30px',
            maxWidth: '600px',
            width: '90%',
            maxHeight: '80vh',
            overflowY: 'auto',
            boxShadow: '0 10px 25px rgba(0,0,0,0.2)'
          }}>
            <h3 style={{
              marginTop: '0',
              marginBottom: '20px',
              color: '#333',
              fontSize: '20px',
              lineHeight: '1.4'
            }}>
              {currentQuestion.question}
            </h3>
            
            <div className="question-options">
              {currentQuestion.options.map((option, index) => (
                <div
                  key={index}
                  onClick={() => handleOptionSelect(index)}
                  style={{
                    padding: '15px',
                    margin: '10px 0',
                    border: '2px solid',
                    borderColor: selectedOption === index ? '#007bff' : '#e9ecef',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    backgroundColor: selectedOption === index ? '#e7f3ff' : 'white',
                    transition: 'all 0.3s ease',
                    fontSize: '16px',
                    lineHeight: '1.4',
                    color: '#333'
                  }}
                  onMouseOver={(e) => {
                    if (selectedOption !== index) {
                      e.currentTarget.style.backgroundColor = '#f8f9fa';
                      e.currentTarget.style.borderColor = '#6c757d';
                    }
                  }}
                  onMouseOut={(e) => {
                    if (selectedOption !== index) {
                      e.currentTarget.style.backgroundColor = 'white';
                      e.currentTarget.style.borderColor = '#e9ecef';
                    }
                  }}
                >
                  {option.text}
                </div>
              ))}
            </div>
            
            <div style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '10px',
              marginTop: '20px'
            }}>
              <button
                onClick={cancelQuestion}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#6c757d',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '16px'
                }}
              >
                Cancel
              </button>
              <button
                onClick={submitAnswer}
                disabled={selectedOption === null}
                style={{
                  padding: '10px 20px',
                  backgroundColor: selectedOption !== null ? '#007bff' : '#6c757d',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: selectedOption !== null ? 'pointer' : 'not-allowed',
                  fontSize: '16px'
                }}
              >
                Submit Answer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Binary Choice Question Popup */}
      {currentBinaryQuestion && !showFeedback && (
        <div className="question-popup-overlay" style={{
          position: 'fixed',
          top: '0',
          left: '0',
          right: '0',
          bottom: '0',
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: '1000'
        }}>
          <div className="question-popup" style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '30px',
            maxWidth: '600px',
            width: '90%',
            maxHeight: '80vh',
            overflowY: 'auto',
            boxShadow: '0 10px 25px rgba(0,0,0,0.2)'
          }}>
            <h3 style={{
              marginTop: '0',
              marginBottom: '20px',
              color: '#333',
              fontSize: '20px',
              lineHeight: '1.4'
            }}>
              {currentBinaryQuestion.question}
            </h3>
            
            <div style={{
              backgroundColor: '#f8f9fa',
              padding: '15px',
              borderRadius: '8px',
              marginBottom: '20px',
              textAlign: 'center'
            }}>
              <p style={{
                margin: '0',
                fontSize: '14px',
                color: '#6c757d'
              }}>
                <strong>Instructions:</strong> Choose your answer by selecting the left or right arrow.
              </p>
              <p style={{
                margin: '5px 0 0 0',
                fontSize: '14px',
                color: '#495057'
              }}>
                <strong>Left (←):</strong> {currentBinaryQuestion.left} | <strong>Right (→):</strong> {currentBinaryQuestion.right}
              </p>
            </div>
            
            <div style={{
              display: 'flex',
              justifyContent: 'center',
              gap: '30px',
              marginBottom: '20px'
            }}>
              <div
                onClick={() => handleBinaryChoiceSelect('left')}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  padding: '20px',
                  border: '3px solid',
                  borderColor: selectedBinaryChoice === 'left' ? '#007bff' : '#e9ecef',
                  borderRadius: '12px',
                  cursor: 'pointer',
                  backgroundColor: selectedBinaryChoice === 'left' ? '#e7f3ff' : 'white',
                  transition: 'all 0.3s ease',
                  minWidth: '120px'
                }}
                onMouseOver={(e) => {
                  if (selectedBinaryChoice !== 'left') {
                    e.currentTarget.style.backgroundColor = '#f8f9fa';
                    e.currentTarget.style.borderColor = '#6c757d';
                  }
                }}
                onMouseOut={(e) => {
                  if (selectedBinaryChoice !== 'left') {
                    e.currentTarget.style.backgroundColor = 'white';
                    e.currentTarget.style.borderColor = '#e9ecef';
                  }
                }}
              >
                <div style={{
                  fontSize: '48px',
                  marginBottom: '10px',
                  color: selectedBinaryChoice === 'left' ? '#007bff' : '#6c757d'
                }}>
                  ←
                </div>
                <div style={{
                  fontSize: '16px',
                  fontWeight: '600',
                  color: '#333',
                  textAlign: 'center'
                }}>
                  {currentBinaryQuestion.left}
                </div>
              </div>
              
              <div
                onClick={() => handleBinaryChoiceSelect('right')}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  padding: '20px',
                  border: '3px solid',
                  borderColor: selectedBinaryChoice === 'right' ? '#007bff' : '#e9ecef',
                  borderRadius: '12px',
                  cursor: 'pointer',
                  backgroundColor: selectedBinaryChoice === 'right' ? '#e7f3ff' : 'white',
                  transition: 'all 0.3s ease',
                  minWidth: '120px'
                }}
                onMouseOver={(e) => {
                  if (selectedBinaryChoice !== 'right') {
                    e.currentTarget.style.backgroundColor = '#f8f9fa';
                    e.currentTarget.style.borderColor = '#6c757d';
                  }
                }}
                onMouseOut={(e) => {
                  if (selectedBinaryChoice !== 'right') {
                    e.currentTarget.style.backgroundColor = 'white';
                    e.currentTarget.style.borderColor = '#e9ecef';
                  }
                }}
              >
                <div style={{
                  fontSize: '48px',
                  marginBottom: '10px',
                  color: selectedBinaryChoice === 'right' ? '#007bff' : '#6c757d'
                }}>
                  →
                </div>
                <div style={{
                  fontSize: '16px',
                  fontWeight: '600',
                  color: '#333',
                  textAlign: 'center'
                }}>
                  {currentBinaryQuestion.right}
                </div>
              </div>
            </div>
            
            <div style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '10px',
              marginTop: '20px'
            }}>
              <button
                onClick={cancelBinaryQuestion}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#6c757d',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '16px'
                }}
              >
                Cancel
              </button>
              <button
                onClick={submitBinaryAnswer}
                disabled={selectedBinaryChoice === null}
                style={{
                  padding: '10px 20px',
                  backgroundColor: selectedBinaryChoice !== null ? '#007bff' : '#6c757d',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: selectedBinaryChoice !== null ? 'pointer' : 'not-allowed',
                  fontSize: '16px'
                }}
              >
                Submit Answer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Feedback Popup */}
      {showFeedback && (
        <div className="feedback-popup-overlay" style={{
          position: 'fixed',
          top: '0',
          left: '0',
          right: '0',
          bottom: '0',
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: '1000'
        }}>
          <div className="feedback-popup" style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '30px',
            maxWidth: '400px',
            width: '90%',
            textAlign: 'center',
            boxShadow: '0 10px 25px rgba(0,0,0,0.2)'
          }}>
            <div style={{
              fontSize: '48px',
              marginBottom: '15px'
            }}>
              {feedbackCorrect ? '✅' : '❌'}
            </div>
            
            <h3 style={{
              marginTop: '0',
              marginBottom: '20px',
              color: feedbackCorrect ? '#28a745' : '#dc3545',
              fontSize: '24px',
              lineHeight: '1.4'
            }}>
              {feedbackCorrect ? 'Correct!' : 'Incorrect'}
            </h3>
            
            {feedbackCorrect && (
              <p style={{
                color: '#6c757d',
                fontSize: '16px',
                margin: '0 0 20px 0'
              }}>
                Great job!
              </p>
            )}
            
            {!feedbackCorrect && (
              <div style={{
                display: 'flex',
                justifyContent: 'center',
                marginTop: '20px'
              }}>
                <button
                  onClick={currentBinaryQuestion ? cancelBinaryQuestion : cancelQuestion}
                  style={{
                    padding: '10px 20px',
                    backgroundColor: '#6c757d',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '16px'
                  }}
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default LearningScreen; 