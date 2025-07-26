import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import '../styles/LearningScreen.css';
import apiService from '../services/apiService';

// Import character images
import studentImage from '../assets/characters/student.jpeg';
import voiceChatIcon from '../assets/voice-chat-icon.jpg';

/**
 * Audio streaming player class for seamless chunk playback
 * 
 * This class handles streaming audio chunks from the backend to provide 
 * seamless playback without stuttering between chunks. It uses the Web Audio API
 * to schedule audio chunks to play consecutively.
 * 
 * Backend Integration:
 * - Command types supported: 'TEACHER_SPEECH', 'CLASSMATE_SPEECH', 'TEACHER_AUDIO_CHUNK', 'CLASSMATE_AUDIO_CHUNK'
 * - stream_complete parameter controls completion timing:
 *   - stream_complete = false: Command marked complete immediately (as soon as pushed to queue)
 *   - stream_complete = true/null: Command marked complete when audio finishes playing
 * - This allows messages without audio (stream_complete=false) to be processed immediately
 *   while messages with audio can wait for playback completion when needed
 */
class StreamingAudioPlayer {
  private audioContext: AudioContext | null = null;
  private nextStartTime: number = 0;
  private isPlaying: boolean = false;
  private pendingChunks: ArrayBuffer[] = [];
  private isProcessing: boolean = false;
  private onEndCallback: (() => void) | null = null;
  private activeSourceNodes: AudioBufferSourceNode[] = [];
  
  async initialize(): Promise<void> {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    
    // Resume context if it's suspended (due to browser autoplay policies)
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
  }
  
  async addChunk(audioBytes: string): Promise<void> {
    try {
      // Convert base64 to ArrayBuffer
      const binaryString = atob(audioBytes);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      this.pendingChunks.push(bytes.buffer);
      
      if (!this.isProcessing) {
        this.processNextChunk();
      }
    } catch (error) {
      console.error('Error adding audio chunk:', error);
    }
  }
  
  private async processNextChunk(): Promise<void> {
    if (this.pendingChunks.length === 0 || !this.audioContext) {
      this.isProcessing = false;
      return;
    }
    
    this.isProcessing = true;
    
    try {
      const chunkBuffer = this.pendingChunks.shift()!;
      const audioBuffer = await this.audioContext.decodeAudioData(chunkBuffer);
      
      const sourceNode = this.audioContext.createBufferSource();
      sourceNode.buffer = audioBuffer;
      sourceNode.connect(this.audioContext.destination);
      
      // Calculate when this chunk should start
      const currentTime = this.audioContext.currentTime;
      const startTime = Math.max(currentTime, this.nextStartTime);
      
      // Schedule the chunk to play
      sourceNode.start(startTime);
      this.activeSourceNodes.push(sourceNode);
      
      // Update next start time
      this.nextStartTime = startTime + audioBuffer.duration;
      
      if (!this.isPlaying) {
        this.isPlaying = true;
      }
      
      // Handle chunk completion
      sourceNode.onended = () => {
        // Remove from active nodes
        const index = this.activeSourceNodes.indexOf(sourceNode);
        if (index > -1) {
          this.activeSourceNodes.splice(index, 1);
        }
        
        // Check if this was the last chunk and no more are pending
        if (this.activeSourceNodes.length === 0 && this.pendingChunks.length === 0) {
          this.isPlaying = false;
          if (this.onEndCallback) {
            this.onEndCallback();
            this.onEndCallback = null;
          }
        }
      };
      
      // Process next chunk if available
      if (this.pendingChunks.length > 0) {
        // Small delay to prevent overwhelming the audio context. 1 ms
        setTimeout(() => this.processNextChunk(), 1);
      } else {
        this.isProcessing = false;
      }
      
    } catch (error) {
      console.error('Error processing audio chunk:', error);
      this.isProcessing = false;
      
      // Continue with next chunk if available
      if (this.pendingChunks.length > 0) {
        setTimeout(() => this.processNextChunk(), 1);
      }
    }
  }
  
  setOnEndCallback(callback: (() => void) | null): void {
    this.onEndCallback = callback;
  }
  
  stop(): void {
    // Stop all active source nodes
    this.activeSourceNodes.forEach(node => {
      try {
        node.stop();
      } catch (e) {
        // Node might already be stopped
      }
    });
    
    this.activeSourceNodes = [];
    this.pendingChunks = [];
    this.isPlaying = false;
    this.isProcessing = false;
    this.nextStartTime = 0;
    
    if (this.onEndCallback) {
      this.onEndCallback();
      this.onEndCallback = null;
    }
  }
  
  getIsPlaying(): boolean {
    return this.isPlaying;
  }
  
  hasActiveAudio(): boolean {
    return this.activeSourceNodes.length > 0 || this.pendingChunks.length > 0;
  }
  
  dispose(): void {
    this.stop();
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
    }
    this.audioContext = null;
  }
}

interface SessionData {
  id: string;
  user_id: string;
  course_id: string;
  created_at: string;
  status: string;
  characters: string[];
  teacher?: FullCharacter;
  classmate?: FullCharacter;
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

interface TwoPlayerGame {
  game_type: string;
  topic: string;
  sides: [string, string];
}

interface CommandMessage {
  type: 'command';
  command: {
    command_type: string;
    payload: any;
  };
}

interface ChatMessage {
  id: string;
  sender: 'teacher' | 'classmate' | 'student';
  message: string;
  timestamp: Date;
}

interface FullCharacter {
  name: string;
  image_url: string;
}

const LearningScreen: React.FC = () => {
  const { courseId } = useParams<{ courseId: string }>();
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
  const [sessionData, setSessionData] = useState<SessionData | null>(null);
  const [teacher, setTeacher] = useState<FullCharacter | null>(null);
  const [classmate, setClassmate] = useState<FullCharacter | null>(null);
  const [whiteboardContent, setWhiteboardContent] = useState<string>('');
  const [currentQuestion, setCurrentQuestion] = useState<MCQQuestion | null>(null);
  const [currentBinaryQuestion, setCurrentBinaryQuestion] = useState<BinaryChoiceQuestion | null>(null);
  const [showFinishButton, setShowFinishButton] = useState<boolean>(false);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [selectedBinaryChoice, setSelectedBinaryChoice] = useState<'left' | 'right' | null>(null);
  const [showFeedback, setShowFeedback] = useState<boolean>(false);
  const [feedbackCorrect, setFeedbackCorrect] = useState<boolean>(false);
  
  // Game state
  const [currentGame, setCurrentGame] = useState<string | null>(null);
  const [showGame, setShowGame] = useState<boolean>(false);
  const [isGameFullScreen, setIsGameFullScreen] = useState<boolean>(false);
  
  // Two-player game state
  const [currentTwoPlayerGame, setCurrentTwoPlayerGame] = useState<TwoPlayerGame | null>(null);
  const [showTwoPlayerGame, setShowTwoPlayerGame] = useState<boolean>(false);
  const [gameTimer, setGameTimer] = useState<number>(180); // 3 minutes in seconds
  const [timerActive, setTimerActive] = useState<boolean>(false);
  const [chosenSide, setChosenSide] = useState<number | null>(null); // 0 for first side, 1 for second side
  const [sideChosen, setSideChosen] = useState<boolean>(false);
  const [studentPoints, setStudentPoints] = useState<string[]>([]);
  const [classmatePoints, setClassmatePoints] = useState<string[]>([]);
  
  // Chat messages state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isChatCollapsed, setIsChatCollapsed] = useState<boolean>(false);
  const [notes, setNotes] = useState<string>('');
  
  // Audio recording states
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isAudioPlaying, setIsAudioPlaying] = useState<boolean>(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  
  // Streaming audio players
  const [teacherAudioPlayer, setTeacherAudioPlayer] = useState<StreamingAudioPlayer | null>(null);
  const [classmateAudioPlayer, setClassmateAudioPlayer] = useState<StreamingAudioPlayer | null>(null);
  const [currentAudioSender, setCurrentAudioSender] = useState<'teacher' | 'classmate' | null>(null);
  
  // Sequential processing state
  const [commandQueue, setCommandQueue] = useState<CommandMessage[]>([]);
  const [shouldProcessNext, setShouldProcessNext] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  
  // Inactivity detection states
  const [isInactive, setIsInactive] = useState<boolean>(false);
  const [showInactivityModal, setShowInactivityModal] = useState<boolean>(false);
  
  // Session tracking
  const sessionStartedRef = useRef<boolean>(false);
  
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
  const isProcessingRef = useRef<boolean>(false);  // Synchronous processing state for immediate checks
  const audioChunksRef = useRef<Blob[]>([]);  // Use ref for audio chunks to avoid stale closure issues
  const chatContainerRef = useRef<HTMLDivElement | null>(null);
  const inactivityTimerRef = useRef<number | null>(null);
  const pingIntervalRef = useRef<number | null>(null);
  const gameTimerRef = useRef<number | null>(null);

  // Activity tracking and inactivity handling
  const resetInactivityTimer = () => {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
    }
    
    // Set inactivity timer for 2 minutes (120000ms)
    inactivityTimerRef.current = setTimeout(() => {
      handleInactivity();
    }, 120000);
  };

  const handleInactivity = () => {
    console.log('User inactive - stopping pings and cleaning up connection');
    setIsInactive(true);
    setShowInactivityModal(true);
    sessionStartedRef.current = false; // Reset session tracking on inactivity
    
    // Stop any playing audio
    teacherAudioPlayer?.stop();
    classmateAudioPlayer?.stop();
    setIsAudioPlaying(false);
    setCurrentAudioSender(null);
    setSpeakingStates({
      teacher: false,
      classmate: false,
      student: false
    });
    
    // Clear ping interval
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
    
    // Close WebSocket connection
    if (websocketRef.current) {
      websocketRef.current.close();
      websocketRef.current = null;
    }
    
    setConnectionStatus('disconnected');
  };

  const handleUserActive = () => {
    console.log('User confirmed active - re-establishing connection');
    setShowInactivityModal(false);
    setIsInactive(false);
    sessionStartedRef.current = false; // Reset session tracking for new connection
    
    // Re-establish WebSocket connection
    if (sessionData) {
      establishWebSocketConnection();
    }
    
    // Reset inactivity timer
    resetInactivityTimer();
  };

  const handleUserInactive = () => {
    console.log('User confirmed inactive - keeping connection closed');
    setShowInactivityModal(false);
    // Keep isInactive as true, don't re-establish connection
  };

  const handleActivity = () => {
    if (!isInactive) {
      resetInactivityTimer();
    }
  };

  const establishWebSocketConnection = () => {
    // Prevent multiple connections
    if (websocketRef.current && websocketRef.current.readyState === WebSocket.OPEN) {
      console.log('WebSocket already connected, skipping connection attempt');
      return;
    }
    
    const websocketUrl = 'ws://localhost:8080/learning-interface';
    setConnectionStatus('connecting');
    
    const ws = new WebSocket(websocketUrl);
    websocketRef.current = ws;

    ws.onopen = () => {
      console.log('WebSocket connected');
      // Send ping to verify connection
      ws.send(JSON.stringify({ 
        type: "ping",
        session_id: sessionData?.id
      }));
      
      // Start sending ping messages every 30 seconds
      pingIntervalRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN && !isInactive) {
          console.log('Sending periodic ping');
          ws.send(JSON.stringify({ 
            type: "ping",
            session_id: sessionData?.id
          }));
        }
      }, 30000); // 30 seconds
    };

    ws.onclose = (_) => {
      console.log('WebSocket disconnected');
      setConnectionStatus('disconnected');
      sessionStartedRef.current = false; // Reset session tracking on disconnect
      
      // Clear ping interval when connection closes
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      setConnectionStatus('disconnected');
      sessionStartedRef.current = false; // Reset session tracking on error
      
      // Clear ping interval on error
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
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
  };

  // Add chat message helper function
  const addChatMessage = (sender: 'teacher' | 'classmate' | 'student', message: string) => {
    const newMessage: ChatMessage = {
      id: Date.now().toString(),
      sender,
      message,
      timestamp: new Date()
    };
    setChatMessages(prev => [...prev, newMessage]);
    
    // Auto-scroll to bottom
    setTimeout(() => {
      if (chatContainerRef.current) {
        chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
      }
    }, 100);
  };

  // Effect to handle queue processing
  useEffect(() => {
    console.log('Queue processing effect triggered:', {
      shouldProcessNext,
      queueLength: commandQueue.length,
      isProcessingRef: isProcessingRef.current,
      isProcessingState: isProcessing
    });
    
    if (shouldProcessNext && commandQueue.length > 0 && !isProcessing) {
      console.log('Processing next command from queue');
      const [nextCommand, ...remainingQueue] = commandQueue;
      setCommandQueue(remainingQueue);
      setShouldProcessNext(false);
      isProcessingRef.current = true;
      setIsProcessing(true);
      processCommand(nextCommand);
    } else if (commandQueue.length === 0 && shouldProcessNext) {
      console.log('Queue empty, resetting processing state');
      setShouldProcessNext(false);
      isProcessingRef.current = false;
      setIsProcessing(false);
    } else if (shouldProcessNext && commandQueue.length > 0 && isProcessing) {
      console.log('Want to process next but still processing current command');
    }
  }, [commandQueue, shouldProcessNext, isProcessing]);

  // Mark current command as complete and process next
  const markCommandComplete = () => {
    console.log('markCommandComplete called', {
      queueLength: commandQueue.length,
      wasProcessingRef: isProcessingRef.current,
      wasProcessingState: isProcessing
    });
    completionCallbackRef.current = null;
    isProcessingRef.current = false;
    setIsProcessing(false);
    setShouldProcessNext(true);
  };

  // Process a single command
  const processCommand = (message: CommandMessage) => {
    const { command_type, payload } = message.command;
    console.log('processCommand started:', command_type, {
      queueLength: commandQueue.length,
      isProcessingRef: isProcessingRef.current,
      isProcessingState: isProcessing
    });
    
    switch (command_type) {
      case 'TEACHER_SPEECH':
        // Set teacher as speaking
        setSpeakingStates(prev => ({ ...prev, teacher: true }));
        setCurrentAudioSender('teacher');
        
        // Add teacher message to chat if text is available
        if (payload.text) {
          addChatMessage('teacher', payload.text);
        }
        
        if (payload.audio_bytes || payload.stream_complete) {
          playStreamingAudio('teacher', payload.audio_bytes, payload.stream_complete);
        } else {
          markCommandComplete();
        }
        break;
        
      case 'CLASSMATE_SPEECH':
        // Set classmate as speaking
        setSpeakingStates(prev => ({ ...prev, classmate: true }));
        setCurrentAudioSender('classmate');
        
        // Add classmate message to chat if text is available
        if (payload.text) {
          addChatMessage('classmate', payload.text);
        }
        
        if (payload.audio_bytes || payload.stream_complete) {
          playStreamingAudio('classmate', payload.audio_bytes, payload.stream_complete);
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
          // Mark command as complete immediately so other commands can be processed
          // The question UI will remain visible until user interacts
          markCommandComplete();
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
          // Mark command as complete immediately so other commands can be processed
          // The question UI will remain visible until user interacts
          markCommandComplete();
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
        
      case 'GAME':
        if (payload.code) {
          try {
            // Decode base64 encoded UTF-8 game code
            const binaryString = atob(payload.code);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            const decoder = new TextDecoder('utf-8');
            const decodedGameCode = decoder.decode(bytes);
            setCurrentGame(decodedGameCode);
            setShowGame(true);
            markCommandComplete();
          } catch (error) {
            console.error('Error decoding game code:', error);
            markCommandComplete();
          }
        } else {
          markCommandComplete();
        }
        break;
        
      case 'TWO_PLAYER_GAME':
        if (payload.game_type && payload.topic && payload.sides) {
          setCurrentTwoPlayerGame({
            game_type: payload.game_type,
            topic: payload.topic,
            sides: payload.sides
          });
          setShowTwoPlayerGame(true);
          setGameTimer(180); // Reset timer to 3 minutes
          setTimerActive(false);
          setChosenSide(null); // Reset side selection
          setSideChosen(false); // Reset side chosen state
          setStudentPoints([]); // Reset student points
          setClassmatePoints([]); // Reset classmate points
          // Mark command as complete immediately to allow other commands to process
          markCommandComplete();
        } else {
          markCommandComplete();
        }
        break;
        
      case 'STUDENT_POINT':
        if (payload.point) {
          setStudentPoints(prev => [...prev, payload.point]);
          console.log('Student point added:', payload.point);
        }
        markCommandComplete();
        break;
        
      case 'CLASSMATE_POINT':
        if (payload.point) {
          setClassmatePoints(prev => [...prev, payload.point]);
          console.log('Classmate point added:', payload.point);
        }
        markCommandComplete();
        break;
        
      default:
        console.log('Unknown command type:', command_type);
        markCommandComplete();
        break;
    }
  };

  // Function to play streaming audio
  const playStreamingAudio = async (sender: 'teacher' | 'classmate', audioBytes: string, streamComplete?: boolean) => {
    const audioPlayer = sender === 'teacher' ? teacherAudioPlayer : classmateAudioPlayer;
    
    if (!audioPlayer) {
      console.error(`Audio player not initialized for ${sender}`);
      markCommandComplete();
      return;
    }

    try {
      // Set audio playing state if not already playing
      if (!audioPlayer.getIsPlaying()) {
        setIsAudioPlaying(true);
      }
      
      // Add the audio chunk to the player first
      if (audioBytes) {
        await audioPlayer.addChunk(audioBytes);
      }
      
      // Handle completion based on stream_complete parameter
      if (streamComplete !== true) {
        // If stream_complete=False, mark as complete immediately (as soon as pushed to queue)
        markCommandComplete();
      } else if (streamComplete === true) {
        // stream_complete=True means wait for all currently buffered audio to finish
        console.log('Setting on end callback for streaming audio - waiting for buffered audio to finish');
        audioPlayer.setOnEndCallback(() => {
            setIsAudioPlaying(false);
            setCurrentAudioSender(null);
            
            // Clear speaking states when audio ends
            setSpeakingStates(prev => ({
                ...prev,
                [sender]: false
            }));
            
            // Add 1 second delay before marking stream_complete=True command as complete
            setTimeout(() => {
                markCommandComplete();
            }, 1000);
        });
      }   
    } catch (error) {
      console.error('Error processing streaming audio:', error);
      setIsAudioPlaying(false);
      setCurrentAudioSender(null);
      setSpeakingStates(prev => ({
        ...prev,
        [sender]: false
      }));
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

  // Finish game
  const finishGame = () => {
    handleContinueLesson();
  };

  const resetTwoPlayerGameState = () => {
    setCurrentTwoPlayerGame(null);
    setShowTwoPlayerGame(false);
    setTimerActive(false);
    setGameTimer(180);
    setChosenSide(null);
    setSideChosen(false);
    setStudentPoints([]);
    setClassmatePoints([]);

    if (gameTimerRef.current) {
      clearTimeout(gameTimerRef.current);
      gameTimerRef.current = null;
    }
  };

  // Two-player game timer effect
  useEffect(() => {
    if (timerActive && gameTimer > 0) {
      gameTimerRef.current = setTimeout(() => {
        setGameTimer(prev => prev - 1);
      }, 1000);
    } else if (gameTimer === 0 && timerActive) {
      // Timer finished
      setTimerActive(false);
      
      // Send finish_two_player_game event to WebSocket but don't clear UI
      if (websocketRef.current && sessionData?.id) {
        const finishGameMessage = {
          type: "finish_two_player_game",
          session_id: sessionData.id
        };
        console.log('Sending finish_two_player_game event (timer ended):', finishGameMessage);
        websocketRef.current.send(JSON.stringify(finishGameMessage));
      }
    }

    return () => {
      if (gameTimerRef.current) {
        clearTimeout(gameTimerRef.current);
      }
    };
  }, [timerActive, gameTimer]);

  // Start two-player game timer
  const startTwoPlayerGameTimer = () => {
    setTimerActive(true);
    
    // Send start_two_player_game event to WebSocket
    if (websocketRef.current && sessionData?.id && currentTwoPlayerGame && chosenSide !== null) {
      const startGameMessage = {
        type: "start_two_player_game",
        payload: {
          ...currentTwoPlayerGame,
          chosen_side: chosenSide
        },
        session_id: sessionData.id
      };
      console.log('Sending start_two_player_game event:', startGameMessage);
      websocketRef.current.send(JSON.stringify(startGameMessage));
    }
  };

  // Finish two-player game
  const finishTwoPlayerGame = () => {
    // Send finish_two_player_game event to WebSocket
    if (websocketRef.current && sessionData?.id) {
      const finishGameMessage = {
        type: "finish_two_player_game",
        session_id: sessionData.id
      };
      console.log('Sending finish_two_player_game event:', finishGameMessage);
      websocketRef.current.send(JSON.stringify(finishGameMessage));
    }
    
    setTimerActive(false);
  };

  // Format timer display
  const formatTimer = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  // Handle side selection
  const handleSideSelection = (sideIndex: number) => {
    setChosenSide(sideIndex);
    setSideChosen(true);
  };

  // Handle continue lesson button click
  const handleContinueLesson = () => {
    // Stop any playing audio and reset audio states
    teacherAudioPlayer?.stop();
    classmateAudioPlayer?.stop();
    setIsAudioPlaying(false);
    setCurrentAudioSender(null);
    setSpeakingStates({
      teacher: false,
      classmate: false,
      student: false
    });
    
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
    
    setCurrentGame(null);
    setShowGame(false);
    setIsGameFullScreen(false);
    
    if (showTwoPlayerGame) {
      resetTwoPlayerGameState();
    }

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
    console.log('handleCommandMessage called', {
      commandType: message.command.command_type,
      isProcessingRef: isProcessingRef.current,
      isProcessingState: isProcessing,
      currentQueueLength: commandQueue.length
    });
    
    if (isProcessingRef.current) {
      // Add to queue if currently processing
      console.log('Adding command to queue:', message.command.command_type);
      setCommandQueue(prevQueue => [...prevQueue, message]);
    } else {
      // Process immediately if not processing
      console.log('Processing command immediately:', message.command.command_type);
      isProcessingRef.current = true;
      setIsProcessing(true);
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
          
          // Start session after successful connection using existing session ID (only once)
          if (sessionData?.id && !sessionStartedRef.current) {
            const startSessionMessage = {
              type: "start_session",
              session_id: sessionData.id
            };
            
            if (websocketRef.current) {
              websocketRef.current.send(JSON.stringify(startSessionMessage));
              sessionStartedRef.current = true; // Mark session as started
              console.log('Session started for the first time');
            }
          } else if (!sessionData?.id) {
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
          
        case 'student_speech':
          // Add student message to chat
          if (message.text) {
            addChatMessage('student', message.text);
          }
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

  // Initialize streaming audio players
  useEffect(() => {
    const initializePlayers = async () => {
      const teacherPlayer = new StreamingAudioPlayer();
      const classmatePlayer = new StreamingAudioPlayer();
      
      try {
        await teacherPlayer.initialize();
        await classmatePlayer.initialize();
        
        setTeacherAudioPlayer(teacherPlayer);
        setClassmateAudioPlayer(classmatePlayer);
        
        console.log('Streaming audio players initialized');
      } catch (error) {
        console.error('Failed to initialize audio players:', error);
      }
    };
    
    initializePlayers();
    
    // Cleanup function
    return () => {
      teacherAudioPlayer?.dispose();
      classmateAudioPlayer?.dispose();
    };
  }, []);

  useEffect(() => {
    const fetchCharacterDetails = async () => {
      if (sessionData && sessionData.teacher && sessionData.classmate) {
        // Prefer character data included directly on the session object (new backend response)
        setTeacher({ name: sessionData.teacher.name, image_url: sessionData.teacher.image_url });
        setClassmate({ name: sessionData.classmate.name, image_url: sessionData.classmate.image_url });
      } else if (sessionData && sessionData.characters && sessionData.characters.length >= 2) {
        try {
          console.log('Fetching character details for:', sessionData.characters);
          const allCharacters = await apiService.getCharacters();
          console.log('All available characters:', allCharacters);
          
          // Find characters based on the role instead of array position
          const teacherChar = allCharacters.find(c => 
            c.role === 'teacher' && sessionData.characters.includes(c.name)
          );
          const classmateChar = allCharacters.find(c => 
            c.role === 'classmate' && sessionData.characters.includes(c.name)
          );

          console.log('Found teacher:', teacherChar);
          console.log('Found classmate:', classmateChar);

          if (teacherChar) {
            setTeacher({ name: teacherChar.name, image_url: teacherChar.image_url });
          }
          if (classmateChar) {
            setClassmate({ name: classmateChar.name, image_url: classmateChar.image_url });
          }
        } catch (error) {
          console.error('Error fetching character details:', error);
        }
      } else {
        console.log('Session data missing characters:', sessionData);
      }
    };
    fetchCharacterDetails();
  }, [sessionData]);

  useEffect(() => {
    if (sessionData && !isInactive) {
      // Connect to WebSocket only after session data is loaded and user is active
      establishWebSocketConnection();
      
      // Start inactivity timer
      resetInactivityTimer();

      // Cleanup function
      return () => {
        // Clear ping interval on cleanup
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = null;
        }
        
        // Clear inactivity timer on cleanup
        if (inactivityTimerRef.current) {
          clearTimeout(inactivityTimerRef.current);
          inactivityTimerRef.current = null;
        }
        
        // Clear game timer on cleanup
        if (gameTimerRef.current) {
          clearTimeout(gameTimerRef.current);
          gameTimerRef.current = null;
        }
        
        // Dispose audio players
        teacherAudioPlayer?.dispose();
        classmateAudioPlayer?.dispose();
        
        if (websocketRef.current) {
          websocketRef.current.close();
        }
      };
    }
  }, [sessionData, isInactive]);

  // Set up activity event listeners
  useEffect(() => {
    const activityEvents = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
    
    activityEvents.forEach(event => {
      document.addEventListener(event, handleActivity, true);
    });

    // Start initial inactivity timer if not inactive
    if (!isInactive && sessionData) {
      resetInactivityTimer();
    }

    return () => {
      // Clean up event listeners
      activityEvents.forEach(event => {
        document.removeEventListener(event, handleActivity, true);
      });
      
      // Clear inactivity timer
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
    };
  }, []);

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

  return (
    <div style={{ 
      minHeight: '100vh', 
      backgroundColor: 'white',
      padding: '20px',
      position: 'relative'
    }}>
      {/* Connection Status - Top Left */}
      <div style={{
        position: 'absolute',
        top: '20px',
        left: '20px',
        zIndex: 100
      }}>
        <div className="connection-indicator">
          <div 
            className="connection-status"
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '8px',
              padding: '8px 16px',
              borderRadius: '20px',
              backgroundColor: '#f8f9fa',
              fontSize: '14px',
              fontWeight: '500',
              border: '1px solid #e9ecef',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              color: '#333'
            }}
          >
            <div 
              className="connection-dot"
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: getConnectionStatusColor(),
              }}
            />
            <span>{connectionStatus === 'connected' ? 'Connected' : connectionStatus === 'connecting' ? 'Connecting...' : 'Disconnected'}</span>
          </div>
        </div>
      </div>

      {/* Hidden Audio Element */}
      <audio ref={audioRef} style={{ display: 'none' }} />

      {/* Main Content Area */}
      <div style={{
        display: 'flex',
        gap: '20px',
        alignItems: 'flex-start',
        marginTop: '60px'
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
                src={teacher?.image_url || '/placeholder-teacher.png'} 
                alt={teacher?.name || 'Teacher'}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover'
                }}
                onError={(e) => {
                  e.currentTarget.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTUwIiBoZWlnaHQ9IjE1MCIgdmlld0JveD0iMCAwIDE1MCAxNTAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIxNTAiIGhlaWdodD0iMTUwIiBmaWxsPSIjRjBGMEYwIi8+Cjx0ZXh0IHg9Ijc1IiB5PSI4MCIgZm9udC1mYW1pbHk9IkFyaWFsIiBmb250LXNpemU9IjE0IiBmaWxsPSIjOTk5IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj5UZWFjaGVyPC90ZXh0Pgo8L3N2Zz4K';
                }}
              />
            </div>
            <span style={{
              fontSize: '14px',
              fontWeight: '600',
              color: '#333',
              textAlign: 'center'
            }}>
              {teacher?.name || 'Teacher'}
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
                src={classmate?.image_url || '/placeholder-classmate.png'} 
                alt={classmate?.name || 'Classmate'}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover'
                }}
                onError={(e) => {
                  e.currentTarget.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTUwIiBoZWlnaHQ9IjE1MCIgdmlld0JveD0iMCAwIDE1MCAxNTAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIxNTAiIGhlaWdodD0iMTUwIiBmaWxsPSIjRkZFQ0IzIi8+Cjx0ZXh0IHg9Ijc1IiB5PSI4MCIgZm9udC1mYW1pbHk9IkFyaWFsIiBmb250LXNpemU9IjE0IiBmaWxsPSIjODU2NDA0IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj5DbGFzc21hdGU8L3RleHQ+Cjwvc3ZnPgo=';
                }}
              />
            </div>
            <span style={{
              fontSize: '14px',
              fontWeight: '600',
              color: '#333',
              textAlign: 'center'
            }}>
              {classmate?.name || 'Classmate'}
            </span>
          </div>
        </div>

        {/* Whiteboard / Two-Player Game */}
        <div className="whiteboard-container" style={{
          backgroundColor: '#ffffff',
          border: '2px solid #e9ecef',
          borderRadius: '10px',
          padding: '20px',
          minHeight: '75vh',
          width: '65%',
          boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
          overflow: 'auto'
        }}>
          {/* Show Two-Player Game Interface */}
          {showTwoPlayerGame && currentTwoPlayerGame ? (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
              minHeight: '70vh'
            }}>
              {/* Timer - Show when side is chosen and game is active */}
              {sideChosen && timerActive && (
                <div style={{
                  alignSelf: 'center',
                  backgroundColor: '#f8f9fa',
                  padding: '12px 25px',
                  borderRadius: '20px',
                  fontSize: '20px',
                  fontWeight: 'bold',
                  color: gameTimer <= 30 ? '#dc3545' : '#333',
                  marginBottom: '20px',
                  border: gameTimer <= 30 ? '2px solid #dc3545' : '2px solid #28a745'
                }}>
                  ⏱️ {formatTimer(gameTimer)}
                </div>
              )}

              {/* Game Title */}
              <h2 style={{
                textAlign: 'center',
                marginTop: '0',
                marginBottom: '20px',
                color: '#333',
                fontSize: '24px',
                fontWeight: 'bold'
              }}>
                🎮 {currentTwoPlayerGame.game_type.replace('_', ' ')}
              </h2>

              {/* Topic */}
              <div style={{
                backgroundColor: '#f8f9fa',
                padding: '15px',
                borderRadius: '8px',
                marginBottom: '20px',
                border: '1px solid #e9ecef'
              }}>
                <h3 style={{
                  margin: '0',
                  textAlign: 'center',
                  color: '#495057',
                  fontSize: '18px',
                  fontWeight: '600'
                }}>
                  Topic: {currentTwoPlayerGame.topic}
                </h3>
              </div>

              {/* Side Selection Interface */}
              {!sideChosen && (
                <div style={{ flex: 1 }}>
                  <div style={{
                    textAlign: 'center',
                    marginBottom: '25px'
                  }}>
                    <h3 style={{
                      color: '#333',
                      fontSize: '20px',
                      fontWeight: '600',
                      marginBottom: '8px'
                    }}>
                      Choose Your Side
                    </h3>
                    <p style={{
                      color: '#6c757d',
                      fontSize: '14px',
                      margin: '0'
                    }}>
                      Select which position you'd like to argue for in this debate
                    </p>
                  </div>

                  {/* Side Selection Options */}
                  <div style={{
                    display: 'flex',
                    gap: '20px',
                    alignItems: 'stretch',
                    height: '350px'
                  }}>
                    {/* Option 1 */}
                    <div 
                      onClick={() => handleSideSelection(0)}
                      style={{
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        padding: '20px',
                        backgroundColor: '#f8f9fa',
                        borderRadius: '12px',
                        border: '2px solid #e9ecef',
                        cursor: 'pointer',
                        transition: 'all 0.3s ease'
                      }}
                      onMouseOver={(e) => {
                        e.currentTarget.style.backgroundColor = '#e7f3ff';
                        e.currentTarget.style.borderColor = '#007bff';
                        e.currentTarget.style.transform = 'translateY(-3px)';
                      }}
                      onMouseOut={(e) => {
                        e.currentTarget.style.backgroundColor = '#f8f9fa';
                        e.currentTarget.style.borderColor = '#e9ecef';
                        e.currentTarget.style.transform = 'translateY(0)';
                      }}
                    >
                      <h4 style={{
                        margin: '0 0 15px 0',
                        color: '#495057',
                        fontSize: '16px',
                        fontWeight: 'bold',
                        textAlign: 'center'
                      }}>
                        Side A
                      </h4>
                      
                      <div style={{
                        backgroundColor: 'white',
                        padding: '15px',
                        borderRadius: '8px',
                        border: '1px solid #e9ecef',
                        textAlign: 'center',
                        fontSize: '14px',
                        lineHeight: '1.4',
                        color: '#333',
                        fontWeight: '500',
                        flex: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}>
                        {currentTwoPlayerGame.sides[0]}
                      </div>

                      <button style={{
                        marginTop: '15px',
                        padding: '10px 20px',
                        backgroundColor: '#007bff',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '12px',
                        fontWeight: '600',
                        cursor: 'pointer'
                      }}>
                        Choose This Side
                      </button>
                    </div>

                    {/* Option 2 */}
                    <div 
                      onClick={() => handleSideSelection(1)}
                      style={{
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        padding: '20px',
                        backgroundColor: '#f8f9fa',
                        borderRadius: '12px',
                        border: '2px solid #e9ecef',
                        cursor: 'pointer',
                        transition: 'all 0.3s ease'
                      }}
                      onMouseOver={(e) => {
                        e.currentTarget.style.backgroundColor = '#fff3cd';
                        e.currentTarget.style.borderColor = '#ffc107';
                        e.currentTarget.style.transform = 'translateY(-3px)';
                      }}
                      onMouseOut={(e) => {
                        e.currentTarget.style.backgroundColor = '#f8f9fa';
                        e.currentTarget.style.borderColor = '#e9ecef';
                        e.currentTarget.style.transform = 'translateY(0)';
                      }}
                    >
                      <h4 style={{
                        margin: '0 0 15px 0',
                        color: '#495057',
                        fontSize: '16px',
                        fontWeight: 'bold',
                        textAlign: 'center'
                      }}>
                        Side B
                      </h4>
                      
                      <div style={{
                        backgroundColor: 'white',
                        padding: '15px',
                        borderRadius: '8px',
                        border: '1px solid #e9ecef',
                        textAlign: 'center',
                        fontSize: '14px',
                        lineHeight: '1.4',
                        color: '#333',
                        fontWeight: '500',
                        flex: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}>
                        {currentTwoPlayerGame.sides[1]}
                      </div>

                      <button style={{
                        marginTop: '15px',
                        padding: '10px 20px',
                        backgroundColor: '#ffc107',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '12px',
                        fontWeight: '600',
                        cursor: 'pointer'
                      }}>
                        Choose This Side
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Game Interface - Show after side is chosen */}
              {sideChosen && chosenSide !== null && (
                <div style={{ flex: 1 }}>
                  {/* Two Sides */}
                  <div style={{
                    display: 'flex',
                    gap: '15px',
                    marginBottom: '15px',
                    height: '400px'
                  }}>
                    {/* Student Side */}
                    <div style={{
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      padding: '15px',
                      backgroundColor: '#e7f3ff',
                      borderRadius: '10px',
                      border: '2px solid #007bff',
                      overflow: 'hidden'
                    }}>
                      <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        marginBottom: '12px'
                      }}>
                        <h4 style={{
                          margin: '0 0 8px 0',
                          color: '#0056b3',
                          fontSize: '14px',
                          fontWeight: 'bold',
                          textAlign: 'center'
                        }}>
                          YOUR SIDE
                        </h4>
                        
                        <div style={{
                          width: '60px',
                          height: '60px',
                          borderRadius: '50%',
                          overflow: 'hidden',
                          border: '2px solid #007bff',
                          marginBottom: '8px'
                        }}>
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
                      </div>

                      <div style={{
                        backgroundColor: 'white',
                        padding: '8px',
                        borderRadius: '6px',
                        border: '1px solid #007bff',
                        textAlign: 'center',
                        fontSize: '10px',
                        lineHeight: '1.2',
                        color: '#333',
                        fontWeight: '500',
                        marginBottom: '10px'
                      }}>
                        {currentTwoPlayerGame.sides[chosenSide]}
                      </div>

                      {/* Student Points */}
                      <div style={{
                        flex: 1,
                        overflowY: 'auto'
                      }}>
                        <h5 style={{
                          margin: '0 0 8px 0',
                          color: '#0056b3',
                          fontSize: '12px',
                          fontWeight: 'bold',
                          textAlign: 'center'
                        }}>
                          Key Points
                        </h5>
                        <div style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px'
                        }}>
                          {studentPoints.map((point, index) => (
                            <div key={index} style={{
                              backgroundColor: 'rgba(255, 255, 255, 0.8)',
                              padding: '6px 8px',
                              borderRadius: '4px',
                              border: '1px solid rgba(0, 123, 255, 0.3)',
                              fontSize: '10px',
                              lineHeight: '1.3',
                              color: '#333'
                            }}>
                              <span style={{ fontWeight: '600', color: '#0056b3' }}>•</span> {point}
                            </div>
                          ))}
                          {studentPoints.length === 0 && (
                            <div style={{
                              textAlign: 'center',
                              color: '#6c757d',
                              fontSize: '10px',
                              fontStyle: 'italic',
                              padding: '10px'
                            }}>
                              No points yet
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* VS Divider */}
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      minWidth: '30px'
                    }}>
                      <div style={{
                        backgroundColor: '#ffc107',
                        color: 'white',
                        padding: '8px',
                        borderRadius: '50%',
                        fontSize: '14px',
                        fontWeight: 'bold',
                        border: '2px solid #e0a800'
                      }}>
                        VS
                      </div>
                    </div>

                    {/* Classmate Side */}
                    <div style={{
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      padding: '15px',
                      backgroundColor: '#fff3cd',
                      borderRadius: '10px',
                      border: '2px solid #ffc107',
                      overflow: 'hidden'
                    }}>
                      <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        marginBottom: '12px'
                      }}>
                        <h4 style={{
                          margin: '0 0 8px 0',
                          color: '#856404',
                          fontSize: '14px',
                          fontWeight: 'bold',
                          textAlign: 'center'
                        }}>
                          {classmate?.name ? `${classmate.name.toUpperCase()}'S SIDE` : "CLASSMATE'S SIDE"}
                        </h4>
                        
                        <div style={{
                          width: '60px',
                          height: '60px',
                          borderRadius: '50%',
                          overflow: 'hidden',
                          border: '2px solid #ffc107',
                          marginBottom: '8px'
                        }}>
                          <img 
                            src={classmate?.image_url || '/placeholder-classmate.png'} 
                            alt={classmate?.name || 'Classmate'}
                            style={{
                              width: '100%',
                              height: '100%',
                              objectFit: 'cover'
                            }}
                            onError={(e) => {
                              e.currentTarget.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTUwIiBoZWlnaHQ9IjE1MCIgdmlld0JveD0iMCAwIDE1MCAxNTAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIxNTAiIGhlaWdodD0iMTUwIiBmaWxsPSIjRkZFQ0IzIi8+Cjx0ZXh0IHg9Ijc1IiB5PSI4MCIgZm9udC1mYW1pbHk9IkFyaWFsIiBmb250LXNpemU9IjE0IiBmaWxsPSIjODU2NDA0IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj5DbGFzc21hdGU8L3RleHQ+Cjwvc3ZnPgo=';
                            }}
                          />
                        </div>
                      </div>

                      <div style={{
                        backgroundColor: 'white',
                        padding: '8px',
                        borderRadius: '6px',
                        border: '1px solid #ffc107',
                        textAlign: 'center',
                        fontSize: '10px',
                        lineHeight: '1.2',
                        color: '#333',
                        fontWeight: '500',
                        marginBottom: '10px'
                      }}>
                        {currentTwoPlayerGame.sides[chosenSide === 0 ? 1 : 0]}
                      </div>

                      {/* Classmate Points */}
                      <div style={{
                        flex: 1,
                        overflowY: 'auto'
                      }}>
                        <h5 style={{
                          margin: '0 0 8px 0',
                          color: '#856404',
                          fontSize: '12px',
                          fontWeight: 'bold',
                          textAlign: 'center'
                        }}>
                          Key Points
                        </h5>
                        <div style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px'
                        }}>
                          {classmatePoints.map((point, index) => (
                            <div key={index} style={{
                              backgroundColor: 'rgba(255, 255, 255, 0.8)',
                              padding: '6px 8px',
                              borderRadius: '4px',
                              border: '1px solid rgba(255, 193, 7, 0.3)',
                              fontSize: '10px',
                              lineHeight: '1.3',
                              color: '#333'
                            }}>
                              <span style={{ fontWeight: '600', color: '#856404' }}>•</span> {point}
                            </div>
                          ))}
                          {classmatePoints.length === 0 && (
                            <div style={{
                              textAlign: 'center',
                              color: '#6c757d',
                              fontSize: '10px',
                              fontStyle: 'italic',
                              padding: '10px'
                            }}>
                              No points yet
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Teacher Section */}
                  <div style={{
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '10px',
                    backgroundColor: '#e8f5e8',
                    borderRadius: '6px',
                    border: '1px solid #28a745',
                    marginBottom: '15px'
                  }}>
                    <div style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '50%',
                      overflow: 'hidden',
                      border: '2px solid #28a745'
                    }}>
                      <img 
                        src={teacher?.image_url || '/placeholder-teacher.png'} 
                        alt={teacher?.name || 'Teacher'}
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover'
                        }}
                        onError={(e) => {
                          e.currentTarget.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTUwIiBoZWlnaHQ9IjE1MCIgdmlld0JveD0iMCAwIDE1MCAxNTAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIxNTAiIGhlaWdodD0iMTUwIiBmaWxsPSIjRjBGMEYwIi8+Cjx0ZXh0IHg9Ijc1IiB5PSI4MCIgZm9udC1mYW1pbHk9IkFyaWFsIiBmb250LXNpemU9IjE0IiBmaWxsPSIjOTk5IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj5UZWFjaGVyPC90ZXh0Pgo8L3N2Zz4K';
                        }}
                      />
                    </div>
                    <div>
                      <h5 style={{
                        margin: '0 0 2px 0',
                        color: '#155724',
                        fontSize: '12px',
                        fontWeight: 'bold'
                      }}>
                        {teacher?.name || 'Teacher'} - Moderator
                      </h5>
                      <p style={{
                        margin: '0',
                        color: '#495057',
                        fontSize: '10px'
                      }}>
                        Ready to moderate this debate!
                      </p>
                    </div>
                  </div>

                  {/* Game Controls */}
                  <div style={{
                    display: 'flex',
                    justifyContent: 'center',
                    gap: '10px'
                  }}>
                    {!timerActive ? (
                      <button
                        onClick={startTwoPlayerGameTimer}
                        style={{
                          padding: '12px 30px',
                          backgroundColor: '#28a745',
                          color: 'white',
                          border: 'none',
                          borderRadius: '8px',
                          fontSize: '16px',
                          fontWeight: 'bold',
                          cursor: 'pointer',
                          transition: 'all 0.3s ease'
                        }}
                        onMouseOver={(e) => {
                          e.currentTarget.style.backgroundColor = '#218838';
                        }}
                        onMouseOut={(e) => {
                          e.currentTarget.style.backgroundColor = '#28a745';
                        }}
                      >
                        🚀 Start Game!
                      </button>
                    ) : (
                      <button
                        onClick={finishTwoPlayerGame}
                        style={{
                          padding: '10px 25px',
                          backgroundColor: '#dc3545',
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '14px',
                          fontWeight: '600',
                          cursor: 'pointer',
                          transition: 'all 0.3s ease'
                        }}
                        onMouseOver={(e) => {
                          e.currentTarget.style.backgroundColor = '#c82333';
                        }}
                        onMouseOut={(e) => {
                          e.currentTarget.style.backgroundColor = '#dc3545';
                        }}
                      >
                        End Game Early
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : showGame && currentGame ? (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
              minHeight: '70vh'
            }}>
               <h2 style={{
                textAlign: 'center',
                marginTop: '0',
                marginBottom: '20px',
                color: '#333',
                fontSize: '24px',
                fontWeight: 'bold'
              }}>
                🎮 Interactive Game
              </h2>
              <div style={{
                  flex: 1,
                  flexBasis: '0',
                  border: '2px solid #e9ecef',
                  borderRadius: '8px',
                  overflow: 'hidden',
                  marginBottom: '20px',
                  height: '60vh'
                }}>
                  <iframe
                    srcDoc={currentGame}
                    style={{
                      width: '100%',
                      height: '100%',
                      border: 'none'
                    }}
                    sandbox="allow-scripts allow-same-origin"
                    title="Interactive Game"
                  />
                </div>
                <div style={{
                  display: 'flex',
                  justifyContent: 'center',
                  gap: '20px'
                }}>
                  <button
                    onClick={finishGame}
                    style={{
                      padding: '12px 24px',
                      backgroundColor: '#dc3545',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '16px',
                      fontWeight: '600',
                      cursor: 'pointer',
                    }}
                  >
                    Finish Game
                  </button>
                  <button
                    onClick={() => setIsGameFullScreen(!isGameFullScreen)}
                    style={{
                      padding: '12px 24px',
                      backgroundColor: '#007bff',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '16px',
                      fontWeight: '600',
                      cursor: 'pointer',
                    }}
                  >
                    {isGameFullScreen ? 'Exit Full Screen' : 'Go Full Screen'}
                  </button>
                </div>
            </div>
          ) : (
            /* Regular Whiteboard */
            <>
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
            </>
          )}
        </div>

        {/* Right Panel - Notes and Chat */}
        <div style={{
          width: '350px',
          display: 'flex',
          flexDirection: 'column',
          height: '75vh',
          gap: '15px'
        }}>
          {/* Notes Area */}
          <div style={{
            backgroundColor: '#ffffff',
            border: '2px solid #e9ecef',
            borderRadius: '10px',
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
            display: 'flex',
            flexDirection: 'column',
            height: isChatCollapsed ? 'calc(70vh - 100px)' : 'calc(35vh - 7.5px)',
            transition: 'height 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            zIndex: 10
          }}>
            {/* Notes Header */}
            <div style={{
              padding: '15px 20px',
              borderBottom: '2px solid #f8f9fa',
              backgroundColor: '#f8f9fa'
            }}>
              <h3 style={{
                margin: '0',
                color: '#333',
                fontSize: '16px',
                fontWeight: '600'
              }}>
                📝 Notes
              </h3>
            </div>

            {/* Notes Content */}
            <div style={{
              flex: 1,
              padding: '15px'
            }}>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Take notes during the lesson..."
                style={{
                  width: '100%',
                  height: '100%',
                  border: 'none',
                  outline: 'none',
                  resize: 'none',
                  fontSize: '14px',
                  fontFamily: 'inherit',
                  lineHeight: '1.5',
                  color: '#333',
                  backgroundColor: 'transparent'
                }}
              />
            </div>
          </div>

          {/* Live Chat Box */}
          <div style={{
            backgroundColor: '#ffffff',
            border: '2px solid #e9ecef',
            borderRadius: '10px',
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
            display: 'flex',
            flexDirection: 'column',
            height: isChatCollapsed ? '135px' : 'calc(45vh - 7.5px)',
            transition: 'height 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            zIndex: 20,
            position: 'relative'
          }}>
            {/* Chat Header - Clickable */}
            <div 
              onClick={() => setIsChatCollapsed(!isChatCollapsed)}
              style={{
                padding: '15px 20px',
                borderBottom: isChatCollapsed ? 'none' : '2px solid #f8f9fa',
                backgroundColor: '#f8f9fa',
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderRadius: isChatCollapsed ? '8px' : '8px 8px 0 0',
                transition: 'all 0.3s ease'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.backgroundColor = '#e9ecef';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.backgroundColor = '#f8f9fa';
              }}
            >
              <h3 style={{
                margin: '0',
                color: '#333',
                fontSize: '16px',
                fontWeight: '600'
              }}>
                💬 Live Chat
              </h3>
              <span style={{
                fontSize: '14px',
                color: '#6c757d',
                transform: isChatCollapsed ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.3s ease'
              }}>
                ▼
              </span>
            </div>

            {!isChatCollapsed && (
              /* Chat Messages */
              <div 
                ref={chatContainerRef}
                style={{
                  flex: 1,
                  padding: '15px',
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px'
                }}
              >
                {chatMessages.length === 0 ? (
                  <p style={{
                    color: '#6c757d',
                    fontStyle: 'italic',
                    textAlign: 'center',
                    margin: '20px 0'
                  }}>
                    Chat messages will appear here...
                  </p>
                ) : (
                  chatMessages.map((msg) => (
                    <div key={msg.id} style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      backgroundColor: msg.sender === 'teacher' ? '#e8f5e8' : 
                                      msg.sender === 'classmate' ? '#fff3cd' : '#e7f3ff',
                      borderLeft: `4px solid ${msg.sender === 'teacher' ? '#28a745' : 
                                              msg.sender === 'classmate' ? '#ffc107' : '#007bff'}`
                    }}>
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}>
                        <span style={{
                          fontSize: '12px',
                          fontWeight: '600',
                          color: msg.sender === 'teacher' ? '#28a745' : 
                                 msg.sender === 'classmate' ? '#856404' : '#0056b3'
                        }}>
                          {msg.sender === 'teacher' ? (teacher?.name || 'Teacher') : 
                           msg.sender === 'classmate' ? (classmate?.name || 'Classmate') : 'You'}
                        </span>
                        <span style={{
                          fontSize: '10px',
                          color: '#6c757d'
                        }}>
                          {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p style={{
                        margin: '0',
                        fontSize: '14px',
                        color: '#333',
                        lineHeight: '1.4'
                      }}>
                        {msg.message}
                      </p>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Chat Input Area - Always Visible */}
            <div style={{
              padding: '15px',
              borderTop: '1px solid #e9ecef',
              backgroundColor: '#f8f9fa',
              borderRadius: '0 0 8px 8px',
              marginTop: 'auto'
            }}>
              <button
                onClick={toggleRecording}
                disabled={isAudioPlaying}
                style={{
                  width: '100%',
                  padding: '12px 20px',
                  backgroundColor: isRecording ? '#dc3545' : (isAudioPlaying ? '#6c757d' : '#007bff'),
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: isAudioPlaying ? 'not-allowed' : 'pointer',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                  transition: 'all 0.3s ease',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
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
                    e.currentTarget.style.transform = 'translateY(-1px)';
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
                <img 
                  src={voiceChatIcon} 
                  alt="Voice Chat" 
                  style={{
                    width: '20px',
                    height: '20px',
                    borderRadius: '50%',
                    animation: isRecording ? 'pulse 1s infinite' : 'none'
                  }}
                />
                {isRecording ? 'Stop Recording' : (isAudioPlaying ? 'Audio Playing...' : 'Speak')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Finish Module Button */}
      {showFinishButton && (
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          marginTop: '10px',
          position: 'relative',
          zIndex: 10
        }}>
          <button
            onClick={handleContinueLesson}
            style={{
              padding: '12px 25px',
              backgroundColor: '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '16px',
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

      {/* Game Overlay */}
      {isGameFullScreen && currentGame && (
        <div className="game-popup-overlay" style={{
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
          <div className="game-popup" style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '20px',
            maxWidth: '90vw',
            maxHeight: '90vh',
            width: '90vw',
            height: '90vh',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 10px 25px rgba(0,0,0,0.2)'
          }}>
            <h3 style={{
              marginTop: '0',
              marginBottom: '20px',
              color: '#333',
              fontSize: '20px',
              textAlign: 'center'
            }}>
              🎮 Interactive Game
            </h3>
            
            <div style={{
              flex: 1,
              border: '2px solid #e9ecef',
              borderRadius: '8px',
              overflow: 'hidden',
              marginBottom: '20px'
            }}>
              <iframe
                srcDoc={currentGame}
                style={{
                  width: '100%',
                  height: '100%',
                  border: 'none'
                }}
                sandbox="allow-scripts allow-same-origin"
                title="Interactive Game"
              />
            </div>
            
            <div style={{
              display: 'flex',
              justifyContent: 'center'
            }}>
              <button
                onClick={() => setIsGameFullScreen(false)}
                style={{
                  padding: '12px 24px',
                  backgroundColor: '#28a745',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                  transition: 'all 0.3s ease'
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.backgroundColor = '#218838';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.backgroundColor = '#28a745';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                Exit Full Screen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Inactivity Modal */}
      {showInactivityModal && (
        <div className="inactivity-modal-overlay" style={{
          position: 'fixed',
          top: '0',
          left: '0',
          right: '0',
          bottom: '0',
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: '2000'
        }}>
          <div className="inactivity-modal" style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '40px',
            maxWidth: '500px',
            width: '90%',
            textAlign: 'center',
            boxShadow: '0 10px 25px rgba(0,0,0,0.3)',
            border: '3px solid #ffc107'
          }}>
            <div style={{
              fontSize: '48px',
              marginBottom: '20px'
            }}>
              ⏰
            </div>
            
            <h3 style={{
              marginTop: '0',
              marginBottom: '20px',
              color: '#333',
              fontSize: '24px',
              fontWeight: '600'
            }}>
              Are you still there?
            </h3>
            
            <p style={{
              color: '#6c757d',
              fontSize: '16px',
              lineHeight: '1.5',
              marginBottom: '30px'
            }}>
              We noticed you've been inactive for a while.
              <br />
              <strong>Would you like to continue your learning session?</strong>
            </p>
            
            <div style={{
              display: 'flex',
              justifyContent: 'center',
              gap: '20px'
            }}>
              <button
                onClick={handleUserInactive}
                style={{
                  padding: '12px 24px',
                  backgroundColor: '#6c757d',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                  transition: 'all 0.3s ease'
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.backgroundColor = '#5a6268';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.backgroundColor = '#6c757d';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                No, I'm Done
              </button>
              
              <button
                onClick={handleUserActive}
                style={{
                  padding: '12px 24px',
                  backgroundColor: '#28a745',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                  transition: 'all 0.3s ease'
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.backgroundColor = '#218838';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.backgroundColor = '#28a745';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                Yes, I'm Still Here!
              </button>
            </div>
            
            <p style={{
              color: '#6c757d',
              fontSize: '12px',
              marginTop: '20px',
              marginBottom: '0'
            }}>
              If you don't respond, the connection will remain closed until you refresh the page.
            </p>
          </div>
        </div>
      )}


    </div>
  );
};

export default LearningScreen; 