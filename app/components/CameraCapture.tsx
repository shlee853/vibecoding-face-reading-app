'use client';

import { useEffect, useRef, useState } from 'react';
import { captureVideoFrame } from './downscale';

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
  /** 권한 거부처럼 사용자가 밖에서 고칠 수 있는 원인은 해결 방법을 함께 보여준다 */
  const [errorHints, setErrorHints] = useState<string[]>([]);
  /** 값이 바뀌면 카메라 시작을 다시 시도한다 */
  const [retryKey, setRetryKey] = useState(0);

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  useEffect(() => {
    let cancelled = false;

    const fail = (message: string, hints: string[] = []) => {
      if (cancelled) return;
      setErrorMessage(message);
      setErrorHints(hints);
      setStatus('error');
    };

    async function startCamera() {
      // 브라우저가 카메라를 막는 원인 중 가장 흔하면서 안내가 없으면 못 알아채는 것이
      // 보안 컨텍스트 문제다. mediaDevices 자체가 없는 것과 구별해서 알려준다.
      if (typeof window !== 'undefined' && !window.isSecureContext) {
        fail(
          '보안 연결이 아니어서 카메라를 쓸 수 없습니다. 브라우저는 HTTPS 또는 localhost에서만 카메라를 허용합니다.',
          [
            `지금 주소: ${window.location.origin}`,
            'IP 주소(예: http://192.168.0.10:3000)로 접속했다면 http://localhost:<포트> 로 바꿔주세요',
          ]
        );
        return;
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        fail('이 브라우저에서는 카메라를 사용할 수 없습니다. 사진 업로드를 이용해주세요.');
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
        const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent);

        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          // 권한 거부는 브라우저와 운영체제 두 층에서 따로 일어난다.
          // 주소창만 안내하면 OS 쪽이 막힌 사용자는 영영 해결하지 못한다.
          fail('카메라 권한이 거부되었습니다.', [
            '① 브라우저: 주소창의 카메라 아이콘을 눌러 "허용"으로 바꿔주세요',
            ...(isMac
              ? [
                  '② macOS: 시스템 설정 → 개인정보 보호 및 보안 → 카메라 에서 사용 중인 브라우저를 켜주세요 (여기가 꺼져 있으면 주소창에서 허용해도 안 됩니다)',
                  '③ macOS 설정을 바꿨다면 브라우저를 완전히 종료했다가 다시 열어야 적용됩니다',
                ]
              : ['② 운영체제의 카메라 개인정보 설정에서 브라우저를 허용해 주세요']),
            '설정을 바꾼 뒤 아래 "다시 시도"를 눌러주세요',
          ]);
        } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
          fail('사용 가능한 카메라 장치를 찾을 수 없습니다.', [
            '외장 웹캠을 쓰신다면 연결 상태를 확인해 주세요',
          ]);
        } else if (name === 'NotReadableError' || name === 'TrackStartError') {
          fail('다른 앱이 카메라를 사용 중이라 시작할 수 없습니다.', [
            'FaceTime, Zoom, Photo Booth 등 카메라를 쓰는 앱을 모두 종료한 뒤 다시 시도해 주세요',
          ]);
        } else {
          fail(
            `카메라를 시작하는 중 문제가 발생했습니다${name ? ` (${name})` : ''}. 사진 업로드를 이용해주세요.`
          );
        }
      }
    }

    startCamera();

    return () => {
      cancelled = true;
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryKey]);

  const handleRetry = () => {
    stopStream();
    setErrorMessage('');
    setErrorHints([]);
    setStatus('loading');
    setRetryKey((k) => k + 1);
  };

  const handleCapture = () => {
    const video = videoRef.current;
    if (!video) return;

    // 미리보기를 거울처럼 좌우 반전해 보여주므로, 찍히는 사진도 같게 만든다.
    // 보이는 것과 찍히는 것이 다르면 사용자가 어색해한다.
    // 동시에 긴 변을 1024px로 줄여 전송·분석 시간을 아낀다.
    const dataUrl = captureVideoFrame(video, { mirror: true });
    if (!dataUrl) return;

    stopStream();
    onCapture(dataUrl);
  };

  const handleCancel = () => {
    stopStream();
    onCancel();
  };

  if (status === 'error') {
    return (
      <div className="border-2 border-dashed border-red-400/60 rounded-lg p-6">
        <div className="text-center">
          <div className="text-4xl mb-3">🚫</div>
          <p className="text-white text-sm leading-relaxed">{errorMessage}</p>
        </div>

        {errorHints.length > 0 && (
          <ul className="mt-4 space-y-2 text-left bg-black/20 rounded-lg p-4">
            {errorHints.map((hint, i) => (
              <li key={i} className="text-gray-200 text-xs leading-relaxed">
                {hint}
              </li>
            ))}
          </ul>
        )}

        <div className="flex gap-3 mt-6">
          <button
            onClick={handleCancel}
            className="flex-1 bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-lg transition"
          >
            사진 업로드로 돌아가기
          </button>
          <button
            onClick={handleRetry}
            className="flex-1 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-bold py-2 px-4 rounded-lg transition"
          >
            다시 시도
          </button>
        </div>
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
          // 거울처럼 좌우를 뒤집어 보여준다. 촬영 결과도 같은 방향으로 저장된다.
          style={{ transform: 'scaleX(-1)' }}
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
