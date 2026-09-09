'use client';

import { useEffect, useRef, useState } from 'react';

interface CameraCaptureProps {
  /** 촬영 성공 → 부모가 preview로 받는다 */
  onCapture: (dataUrl: string) => void;
  /** 사용자가 카메라를 접음 → 업로드로 복귀 */
  onCancel: () => void;
}

type CameraStatus = 'loading' | 'ready' | 'error';

/**
 * 웹캠으로 실시간 미리보기를 보여주고 한 프레임을 캡처하는 컴포넌트.
 * 스트림은 useRef로 들고 있다 — state에 넣으면 cleanup이 낡은 값을 볼 수 있다.
 */
export default function CameraCapture({ onCapture, onCancel }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  useEffect(() => {
    let cancelled = false;

    async function startCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        if (!cancelled) {
          setStatus('error');
          setErrorMessage(
            '이 브라우저 또는 환경에서는 카메라를 사용할 수 없습니다. 사진 업로드를 이용해주세요.'
          );
        }
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user' },
        });

        if (cancelled) {
          // 마운트 해제 사이에 권한 응답이 온 경우 — 바로 정리한다.
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        const name = err instanceof Error ? err.name : '';
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          setErrorMessage(
            '카메라 권한이 거부되었습니다. 브라우저 주소창의 카메라 아이콘에서 허용해 주세요.'
          );
        } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
          setErrorMessage('사용 가능한 카메라 장치를 찾을 수 없습니다.');
        } else {
          setErrorMessage('카메라를 시작하는 중 문제가 발생했습니다. 사진 업로드를 이용해주세요.');
        }
        setStatus('error');
      }
    }

    startCamera();

    return () => {
      cancelled = true;
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCapture = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);

    stopStream();
    onCapture(dataUrl);
  };

  const handleCancel = () => {
    stopStream();
    onCancel();
  };

  if (status === 'error') {
    return (
      <div className="border-2 border-dashed border-red-400/60 rounded-lg p-8 text-center">
        <div className="text-4xl mb-4">🚫</div>
        <p className="text-white text-sm leading-relaxed mb-6">{errorMessage}</p>
        <button
          onClick={handleCancel}
          className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-6 rounded-lg transition"
        >
          사진 업로드로 돌아가기
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="relative rounded-lg overflow-hidden bg-black/40">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-auto max-h-96 object-cover"
        />
        {status === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center text-white text-sm">
            카메라를 준비하는 중...
          </div>
        )}
      </div>

      <div className="flex gap-4">
        <button
          onClick={handleCancel}
          className="flex-1 bg-gray-600 hover:bg-gray-700 text-white font-bold py-3 px-6 rounded-lg transition"
        >
          취소
        </button>
        <button
          onClick={handleCapture}
          disabled={status !== 'ready'}
          className="flex-1 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:from-gray-600 disabled:to-gray-600 disabled:cursor-not-allowed text-white font-bold py-3 px-6 rounded-lg transition"
        >
          📸 촬영하기
        </button>
      </div>
    </div>
  );
}
