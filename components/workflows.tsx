'use client';
import Spotlight from "@/components/spotlight";
import * as TG from '@telegram-apps/telegram-ui';
import {Icon28Close} from "@telegram-apps/telegram-ui/dist/icons/28/close";
import {Button} from "@headlessui/react";
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker'
import { TimeView } from '@mui/x-date-pickers/models'
import dayjs, { Dayjs } from 'dayjs'
import useMasonry from "@/utils/useMasonry";
import {useEffect, useMemo, useRef, useState} from "react";
import {Icon24Close} from "@telegram-apps/telegram-ui/dist/icons/24/close";
import { useDisks, DEFAULT_DISK_ITEM, type DiskItem, useOccupiedRanges } from "@/app/api/fetches";
import { createTheme, ThemeProvider } from '@mui/material/styles';
import utc from 'dayjs/plugin/utc';
import {Icon24QR} from "@telegram-apps/telegram-ui/dist/icons/24/qr";
import jsQR from "jsqr";

const COOLDOWN_MS = 5000;

// Подключаем плагин для работы с UTC
dayjs.extend(utc);

function intervalsOverlap(aStart: Dayjs, aEnd: Dayjs, bStart: Dayjs, bEnd: Dayjs) {
  return aStart.isBefore(bEnd) && aEnd.isAfter(bStart);
}

export const DEFAULT_BOOKING_ITEM: Booking = {
    id: -1,
    disk_name: "loading...",
    start_ts: Math.floor(Date.now() / 1000) + 30 * 60
};

interface Booking {
  id: number;
  disk_name: string;
  start_ts: number; // Unix timestamp
}

const theme = createTheme({
  zIndex: {
    modal: 9999,
    tooltip: 9999,
    mobileStepper: 9999
  },
});

interface CameraStreamProps {
  wsUrl: string;
  diskName: string;
  revert_flagv: boolean
}

const CameraStream = ({ wsUrl, diskName, revert_flagv }: CameraStreamProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const detectorRef = useRef<any | null>(null);
  const lastSentAtRef = useRef<number>(0);
  const lastCodeRef = useRef<string | null>(null);
  const scanningRef = useRef<boolean>(true);

  useEffect(() => {
    // Формируем URL с логином
    const fullUrl = `${wsUrl}`;
    const ws = new WebSocket(fullUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      // Отправляем мета-данные при подключении
      ws.send(JSON.stringify({
        type: "meta",
        disk: diskName,
        filename: "scan.jpg",
        date_now: Date.now().toString()
      }));
    };

    ws.onmessage = (event) => {
      try {
        const response = JSON.parse(event.data);
        if (response.type === 'result') {
          const { confirmed, disk } = response.data;
          if (confirmed === true && disk === diskName) {
            if (revert_flagv == true){
              const params = new URLSearchParams();
              params.append('disk', diskName);
              window.location.href = '/api/unblock';
            } else {
              window.location.href = '/api/check';
            }

          } else {
            alert(`Ошибка выдачи! Сервер вернул: ${disk}`);
            window.location.reload();
          }
        }
      } catch (e) { console.error(e); }
    };

    if ((window as any).BarcodeDetector) {
      try {
        const supportedFormats = ["qr_code"];
        // TS может не знать тип BarcodeDetector, используем any
        const BarcodeDetectorCtor = (window as any).BarcodeDetector;
        detectorRef.current = new BarcodeDetectorCtor({ formats: supportedFormats });
      } catch (err) {
        console.warn("BarcodeDetector init failed, fallback to jsQR", err);
        detectorRef.current = null;
      }
    } else {
      detectorRef.current = null; // будем использовать jsQR
    }

    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (videoRef.current) videoRef.current.srcObject = stream;
      } catch (err) { alert("Ошибка доступа к камере"); }
    };

    startCamera();

    const SCAN_INTERVAL = 500;

    const intervalId = setInterval(async () => {
      const video = videoRef.current;
      const wsNow = wsRef.current;
      if (!video || !wsNow || wsNow.readyState !== WebSocket.OPEN) return;
      if (!scanningRef.current) return;

      // Обрезаем кадр в canvas
      const canvas = document.createElement("canvas");
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) return;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, w, h);

      try {
        if (detectorRef.current) {
          const bitmap = await createImageBitmap(canvas);
          const results = await detectorRef.current.detect(bitmap);
          bitmap.close();
          if (results && results.length > 0) {
            const codeValue = results[0].rawValue ?? results[0].rawData ?? "";
            const now = Date.now();
            if (codeValue && (now - lastSentAtRef.current > COOLDOWN_MS || codeValue !== lastCodeRef.current)) {
              lastSentAtRef.current = now;
              lastCodeRef.current = codeValue;
              canvas.toBlob((blob) => {
                if (blob && wsNow.readyState === WebSocket.OPEN) {
                  wsNow.send(blob);
                  wsNow.send(JSON.stringify({ type: "end" }));
                  // scanningRef.current = false;
                }
              }, "image/jpeg", 0.7);
            }
          }
        } else {
          const imageData = ctx.getImageData(0, 0, w, h);
          const code = jsQR(imageData.data, w, h);
          if (code?.data) {
            const codeValue = code.data;
            const now = Date.now();
            if (codeValue && (now - lastSentAtRef.current > COOLDOWN_MS || codeValue !== lastCodeRef.current)) {
              lastSentAtRef.current = now;
              lastCodeRef.current = codeValue;
              canvas.toBlob((blob) => {
                if (blob && wsNow.readyState === WebSocket.OPEN) {
                  wsNow.send(blob);
                  wsNow.send(JSON.stringify({ type: "end" }));
                  // scanningRef.current = false;
                }
              }, "image/jpeg", 0.7);
            }
          }
        }
      } catch (err) {
        console.error("QR detection error:", err);
      }
    }, SCAN_INTERVAL);

    return () => {
      clearInterval(intervalId);
      ws.close();
      const tracks = (videoRef.current?.srcObject as MediaStream)?.getTracks();
      tracks?.forEach(t => t.stop());
    };
  }, [wsUrl, diskName]);

  return <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
};

// --- КОМПОНЕНТ КНОПКИ ---
const QrScannerButton = ({ bookings, revert_flag }: { bookings: Booking[]; revert_flag: boolean }) => {
  const [isOpen, setIsOpen] = useState(false);

  // Ищем ближайшую бронь
  const nextBooking = bookings
      .sort((a, b) => a.start_ts - b.start_ts)
      .find(b => dayjs.unix(b.start_ts).isAfter(dayjs().subtract(2, 'hours')));

  if (!nextBooking) return null;

  const now = dayjs();
  const diffMinutes = dayjs.unix(nextBooking.start_ts).diff(now, 'minute');
  const isTooEarly = diffMinutes > 60; // Если до начала больше часа — кнопка "отключена"

  return (
      <>
        <div style={{ padding: '16px 0', maxWidth: '400px', margin: '0 auto' }}>
          <TG.Button
              size="l"
              mode="filled"
              onClick={() => !isTooEarly && setIsOpen(true)}
              before={<Icon24QR />}
              style={{ width: '100%', opacity: isTooEarly ? 0.5 : 1 }}
          >
            {isTooEarly ? `Сканер через ${diffMinutes} мин` : 'Получить диск (QR)'}
          </TG.Button>
        </div>

        <TG.Modal open={isOpen} onOpenChange={setIsOpen}>
          <TG.Modal.Header>{nextBooking.disk_name}</TG.Modal.Header>
          <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ width: '250px', height: '250px', borderRadius: '40px', overflow: 'hidden', border: '4px solid var(--tgui--link_color)', background: '#000' }}>
              {isOpen && <CameraStream wsUrl="/api/ws/upload" diskName={nextBooking.disk_name} revert_flagv={revert_flag}/>}
            </div>
            <p style={{ marginTop: '16px', color: 'gray' }}>Наведите камеру на QR код</p>
          </div>
        </TG.Modal>
      </>
  );
};

export default function Workflows() {
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [loading_auth, setLoading] = useState(true);
  const { data, loading, error } = useDisks();
  const [bookings, setBookings] = useState<Booking[]>([DEFAULT_BOOKING_ITEM]);
  const [bookings_revert, setBookings_revert] = useState<Booking[]>([DEFAULT_BOOKING_ITEM]);

  let testimonials: DiskItem[] = [];
  if (loading) testimonials = [DEFAULT_DISK_ITEM];
  else testimonials = data.length > 0 ? data : [];

  testimonials = [DEFAULT_DISK_ITEM]; //DEBUG

  const masonryContainer = useMasonry();
  const [category, setCategory] = useState<number>(1);
  const [value, setValue] = useState('');

  useEffect(() => {
    fetch('https://tamelaos.fun/auth/verify', {
      method: 'GET',
      credentials: 'include'
    })
        .then(response => {
          if (response.ok) {
            setIsAuthorized(true);
          } else {
            // Если 401 или любая другая ошибка — на выход
            //window.location.href = 'https://tamelaos.fun/auth/login'; // DEBUG
            setIsAuthorized(true); // DEBUG
          }
        })
        .catch(() => {
          // Ошибка сети или сервер лежит
          //window.location.href = 'https://tamelaos.fun/auth/login'; // DEBUG
          setIsAuthorized(true); // DEBUG
        })
        .finally(() => setLoading(false));
  }, []);


  useEffect(() => {
    const init = async () => {
      try {

        const bookingsRes = await fetch('/api/my_bookings', {
          credentials: 'include'
        });

        if (bookingsRes.ok) {
          const bookingsData = await bookingsRes.json();
          setBookings(bookingsData);
        }
      } catch (e) {
        console.error("Ошибка загрузки данных:", e);
      }
    };

    init();
  }, []);

  useEffect(() => {
    const init = async () => {
      try {
        const params = new URLSearchParams({
          pickupped: "1",
        });
        const bookings_revertRes = await fetch(`/api/my_bookings?${params}`, {
          credentials: 'include'
        });

        if (bookings_revertRes.ok) {
          const bookingsData_revert = await bookings_revertRes.json();
          setBookings_revert(bookingsData_revert);
        }
      } catch (e) {
        console.error("Ошибка загрузки данных:", e);
      }
    };

    init();
  }, []);

  // Заменить на ожидпние
  if (loading_auth) return <div>Проверка доступа...</div>;



  const filteredTestimonials = testimonials.filter((t) => {
    const matchesCategory = category === 1 || t.categories.includes(category);
    const matchesSearch = t.name.toLowerCase().includes(value.toLowerCase()) ||
        t.content.toLowerCase().includes(value.toLowerCase());

    // Элемент остается, только если оба условия верны
    return matchesCategory && matchesSearch;
  });


  return (
    <section>
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="pb-12 md:pb-20">
          {/* Section header */}
          <div className="mx-auto max-w-3xl pb-12 text-center md:pb-20">
            <div className="inline-flex items-center gap-3 pb-3 before:h-px before:w-8 before:bg-linear-to-r before:from-transparent before:to-indigo-200/50 after:h-px after:w-8 after:bg-linear-to-l after:from-transparent after:to-indigo-200/50">
              <span className="inline-flex bg-linear-to-r from-indigo-500 to-indigo-200 bg-clip-text text-transparent">
                Tailored Workflows
              </span>
            </div>
            <h2 className="animate-[gradient_6s_linear_infinite] bg-[linear-gradient(to_right,var(--color-gray-200),var(--color-indigo-200),var(--color-gray-50),var(--color-indigo-300),var(--color-gray-200))] bg-[length:200%_auto] bg-clip-text pb-4 font-nacelle text-3xl font-semibold text-transparent md:text-4xl">
              Map your product journey
            </h2>
            <p className="text-lg text-indigo-200/65">
              Simple and elegant interface to start collaborating with your team
              in minutes. It seamlessly integrates with your code and your
              favorite programming languages.
            </p>
          </div>

          <QrScannerButton bookings={bookings} revert_flag={false}/>
          <QrScannerButton bookings={bookings_revert} revert_flag={true}/>

          {/* Buttons */}
          <div className="flex justify-center pb-12 md:pb-16">
            <div className="relative inline-flex flex-wrap justify-center rounded-[1.25rem] bg-gray-800/40 p-1">
              {/* Button #1 */}
              <button
                  className={`flex h-8 flex-1 items-center gap-2.5 whitespace-nowrap rounded-full px-3 text-sm font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-indigo-200 ${category === 1 ? "relative bg-linear-to-b from-gray-900 via-gray-800/60 to-gray-900 before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:border before:border-transparent before:[background:linear-gradient(to_bottom,--theme(--color-indigo-500/0),--theme(--color-indigo-500/.5))_border-box] before:[mask-composite:exclude_!important] before:[mask:linear-gradient(white_0_0)_padding-box,_linear-gradient(white_0_0)]" : "opacity-65 transition-opacity hover:opacity-90"}`}
                  aria-pressed={category === 1}
                  onClick={() => setCategory(1)}
              >
                <svg
                    className={`fill-current ${category === 1 ? "text-indigo-500" : "text-gray-600"}`}
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height={16}
                >
                  <path d="M.062 10.003a1 1 0 0 1 1.947.455c-.019.08.01.152.078.19l5.83 3.333c.052.03.115.03.168 0l5.83-3.333a.163.163 0 0 0 .078-.188 1 1 0 0 1 1.947-.459 2.161 2.161 0 0 1-1.032 2.384l-5.83 3.331a2.168 2.168 0 0 1-2.154 0l-5.83-3.331a2.162 2.162 0 0 1-1.032-2.382Zm7.854-7.981-5.83 3.332a.17.17 0 0 0 0 .295l5.828 3.33c.054.031.118.031.17.002l5.83-3.333a.17.17 0 0 0 0-.294L8.085 2.023a.172.172 0 0 0-.17-.001ZM9.076.285l5.83 3.332c1.458.833 1.458 2.935 0 3.768l-5.83 3.333c-.667.38-1.485.38-2.153-.001l-5.83-3.332c-1.457-.833-1.457-2.935 0-3.767L6.925.285a2.173 2.173 0 0 1 2.15 0Z" />
                </svg>
                <span>View All</span>
              </button>
              {/* Button #2 */}
              <button
                  className={`flex h-8 flex-1 items-center gap-2.5 whitespace-nowrap rounded-full px-3 text-sm font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-indigo-200 ${category === 2 ? "relative bg-linear-to-b from-gray-900 via-gray-800/60 to-gray-900 before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:border before:border-transparent before:[background:linear-gradient(to_bottom,--theme(--color-indigo-500/0),--theme(--color-indigo-500/.5))_border-box] before:[mask-composite:exclude_!important] before:[mask:linear-gradient(white_0_0)_padding-box,_linear-gradient(white_0_0)]" : "opacity-65 transition-opacity hover:opacity-90"}`}
                  aria-pressed={category === 2}
                  onClick={() => setCategory(2)}
              >
                <svg
                    className={`fill-current ${category === 2 ? "text-indigo-500" : "text-gray-600"}`}
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height={16}
                >
                  <path d="M6.5 3.5a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0ZM9 6.855A3.502 3.502 0 0 0 8 0a3.5 3.5 0 0 0-1 6.855v1.656L5.534 9.65a3.5 3.5 0 1 0 1.229 1.578L8 10.267l1.238.962a3.5 3.5 0 1 0 1.229-1.578L9 8.511V6.855Zm2.303 4.74c.005-.005.01-.01.013-.016l.012-.016a1.5 1.5 0 1 1-.025.032ZM3.5 11A1.497 1.497 0 0 1 5 12.5 1.5 1.5 0 1 1 3.5 11Z" />
                </svg>
                <span>Web Apps</span>
              </button>
              {/* Button #3 */}
              <button
                  className={`flex h-8 flex-1 items-center gap-2.5 whitespace-nowrap rounded-full px-3 text-sm font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-indigo-200 ${category === 3 ? "relative bg-linear-to-b from-gray-900 via-gray-800/60 to-gray-900 before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:border before:border-transparent before:[background:linear-gradient(to_bottom,--theme(--color-indigo-500/0),--theme(--color-indigo-500/.5))_border-box] before:[mask-composite:exclude_!important] before:[mask:linear-gradient(white_0_0)_padding-box,_linear-gradient(white_0_0)]" : "opacity-65 transition-opacity hover:opacity-90"}`}
                  aria-pressed={category === 3}
                  onClick={() => setCategory(3)}
              >
                <svg
                    className={`fill-current ${category === 3 ? "text-indigo-500" : "text-gray-600"}`}
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height={16}
                >
                  <path d="M2.428 10c.665-1.815 1.98-3.604 3.44-4.802-.6-1.807-1.443-3.079-2.29-3.18-1.91-.227-2.246 2.04-.174 2.962a1 1 0 1 1-.813 1.827C-1.407 5.028-.589-.491 3.815.032c1.605.191 2.925 1.811 3.79 4.07.979-.427 1.937-.51 2.735-.092.818.429 1.143 1.123 1.294 2.148.015.1.022.149.043.32.542-.537 1.003-.797 1.693-.622.64.162.894.493 1.195 1.147l.018.04a1 1 0 0 1 1.133 1.61c-.46.47-1.12.574-1.744.398a1.661 1.661 0 0 1-.87-.592 2.127 2.127 0 0 1-.224-.349 3.225 3.225 0 0 1-.55.477c-.377.253-.8.368-1.259.267-.993-.218-1.21-.779-1.367-2.05-.027-.22-.033-.262-.046-.353-.067-.452-.144-.617-.244-.67-.225-.118-.665-.013-1.206.278.297 1.243.475 2.587.516 3.941H15a1 1 0 0 1 0 2H8.68l-.025.285c-.173 1.918-.906 3.381-2.654 3.668-1.5.246-3.013-.47-3.677-1.858-.29-.637-.39-1.35-.342-2.095H1a1 1 0 0 1 0-2h1.428Zm2.11 0h2.175a18.602 18.602 0 0 0-.284-2.577c-.205.202-.408.42-.606.654A9.596 9.596 0 0 0 4.537 10Zm2.135 2H3.942c-.032.465.03.888.194 1.25.258.538.89.836 1.54.73.546-.09.888-.772.988-1.875L6.673 12Z" />
                </svg>
                <span>eCommerce</span>
              </button>
              {/* Button #4 */}
              <button
                  className={`flex h-8 flex-1 items-center gap-2.5 whitespace-nowrap rounded-full px-3 text-sm font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-indigo-200 ${category === 4 ? "relative bg-linear-to-b from-gray-900 via-gray-800/60 to-gray-900 before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:border before:border-transparent before:[background:linear-gradient(to_bottom,--theme(--color-indigo-500/0),--theme(--color-indigo-500/.5))_border-box] before:[mask-composite:exclude_!important] before:[mask:linear-gradient(white_0_0)_padding-box,_linear-gradient(white_0_0)]" : "opacity-65 transition-opacity hover:opacity-90"}`}
                  aria-pressed={category === 4}
                  onClick={() => setCategory(4)}
              >
                <svg
                    className={`fill-current ${category === 4 ? "text-indigo-500" : "text-gray-600"}`}
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height={16}
                >
                  <path d="M3.757 3.758a6 6 0 0 1 8.485 8.485 5.992 5.992 0 0 1-5.301 1.664 1 1 0 1 0-.351 1.969 8 8 0 1 0-4.247-2.218 1 1 0 0 0 1.415-.001L9.12 8.294v1.827a1 1 0 1 0 2 0v-4.2a.997.997 0 0 0-1-1.042H5.879a1 1 0 1 0 0 2h1.829l-4.599 4.598a6 6 0 0 1 .648-7.719Z" />
                </svg>
                <span>Enteprise</span>
              </button>
              {/* Button #5 */}
              <button
                  className={`flex h-8 flex-1 items-center gap-2.5 whitespace-nowrap rounded-full px-3 text-sm font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-indigo-200 ${category === 5 ? "relative bg-linear-to-b from-gray-900 via-gray-800/60 to-gray-900 before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:border before:border-transparent before:[background:linear-gradient(to_bottom,--theme(--color-indigo-500/0),--theme(--color-indigo-500/.5))_border-box] before:[mask-composite:exclude_!important] before:[mask:linear-gradient(white_0_0)_padding-box,_linear-gradient(white_0_0)]" : "opacity-65 transition-opacity hover:opacity-90"}`}
                  aria-pressed={category === 5}
                  onClick={() => setCategory(5)}
              >
                <svg
                    className={`fill-current ${category === 5 ? "text-indigo-500" : "text-gray-600"}`}
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height={16}
                >
                  <path d="M13.95.879a3 3 0 0 0-4.243 0L1.293 9.293a1 1 0 0 0-.274.51l-1 5a1 1 0 0 0 1.177 1.177l5-1a1 1 0 0 0 .511-.273l1.16-1.16a1 1 0 0 0-1.414-1.414l-.946.946-3.232.646.646-3.232 8.2-8.2a1 1 0 0 1 1.414 0l1.172 1.172a1 1 0 0 1 0 1.414l-.55.549a1 1 0 0 0 1.415 1.414l.55-.55a3 3 0 0 0 0-4.241L13.948.879ZM3.25 4.5a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Zm11.474 6.029-1.521-.752-.752-1.521c-.168-.341-.73-.341-.896 0l-.752 1.52-1.521.753a.498.498 0 0 0 0 .896l1.52.752.753 1.52a.5.5 0 0 0 .896 0l.752-1.52 1.52-.752a.498.498 0 0 0 0-.896Z" />
                </svg>
                <span>Enteprise</span>
              </button>
            </div>
          </div>

          <TG.Input className="clear-input" id="TG.InputName" status="focused" header="Input" placeholder="Название" value={value} onChange={e => setValue(e.target.value)} after={<TG.Tappable Component="div" style={{
            display: 'flex',
            background: 'transparent'
          }} onClick={() => setValue('')}>
            <div className="button-color-icon">
              <Icon24Close />
            </div>
          </TG.Tappable>} />

          <div className="border-t py-12 [border-image:linear-gradient(to_right,transparent,--theme(--color-slate-400/.25),transparent)1] md:py-20">
            {/* Cards */}
            <div className="mx-auto my-0 grid gap-6" 
                style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', maxWidth: '1400px' }}
                ref={masonryContainer}
            >
              {filteredTestimonials.map((t, i) => (
                <div key={i} className="group">
                  <Spotlight className="w-full">
                    <div className="w-full aspect-[4/3] md:aspect-[16/9] p-4 min-h-[450px] max-h-[460px]">
                      <Testimonial testimonial={t} category={category}>
                        {t.content}
                      </Testimonial>
                    </div>
                  </Spotlight>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function Testimonial({
                              testimonial,
                              category,
                              children,
                            }: {
  testimonial: DiskItem;
  category: number;
  children: React.ReactNode;
}) {
  const [duration, setDuration] = useState(1800); // По умолчанию 30 мин (1800 сек)
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  const handleBook = async () => {
    setIsLoading(true);

    // Формируем JSON
    if (pickerDate != null) {
      const requestData = {
        disk_name: testimonial.name,
        // Преобразуем в POSIX UTC+0 (секунды)
        start_ts: pickerDate.utc().unix(),
        duration: duration,
      };

      try {
        const response = await fetch('/api/block', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(requestData),
        });

        if (response.ok) {
          alert('Забронировано успешно!');
          setIsOpen(false);
        } else {
          alert(await response.text());
        }
      } catch (error) {
        console.error('Ошибка при бронировании:', error);
      } finally {
        setIsLoading(false);
      }
    } else {
      alert('Выберете дату');
    }
  };

  const [pickerDate, setPickerDate] = useState<Dayjs | null>(dayjs().startOf('day'));
  const { occupied } = useOccupiedRanges(pickerDate, testimonial.id);

  const occupiedDayjs = useMemo(() => {
    return occupied.map(r => ({
      start: dayjs(r.start),
      end: dayjs(r.end)
    }));
  }, [occupied]);

  const shouldDisableTimeRange = (date: Dayjs | null, view: TimeView): boolean => {
    if (!date) return false;

    // 1. Ограничение по рабочему времени (12:00 - 18:00)
    const hour = date.hour();
    if (hour < 12 || hour > 18) return true;

    // Минимальная длительность брони (тот же шаг, что у вас в слайдере)
    const MIN_DURATION_MINUTES = 30;

    // Функция проверки: свободен ли конкретный слот длительностью 30 мин
    const isSlotOccupied = (startData: Dayjs) => {
      const slotStart = startData;
      const slotEnd = slotStart.add(MIN_DURATION_MINUTES, 'minute');

      return occupiedDayjs.some(it =>
          intervalsOverlap(slotStart, slotEnd, it.start, it.end)
      );
    };

    // 2. Логика для выбора ЧАСА
    if (view === 'hours') {
      // Проверяем все возможные точки старта внутри этого часа (00 и 30 минут)
      const startAt00 = date.startOf('hour');
      const startAt30 = date.startOf('hour').add(30, 'minute');

      // Если И 00 занято, И 30 занято — тогда блокируем весь час.
      // Если хотя бы одно время свободно — разрешаем нажать на час.
      const is00Blocked = isSlotOccupied(startAt00);
      const is30Blocked = isSlotOccupied(startAt30);

      return is00Blocked && is30Blocked;
    }

    // 3. Логика для выбора МИНУТ (когда час уже выбран)
    if (view === 'minutes') {
      // Здесь date — это конкретная минута, на которую навели (13:00 или 13:30)
      return isSlotOccupied(date);
    }

    return false;
  };

// Хелпер для проверки пересечения интервалов (если у вас его нет)
  function intervalsOverlap(start1: Dayjs, end1: Dayjs, start2: Dayjs, end2: Dayjs) {
    return start1.isBefore(end2) && start2.isBefore(end1);
  }

  return (
      <TG.Modal
          open={isOpen}
          onOpenChange={setIsOpen}
          // Отключаем автофокус
          autoFocus={false}
          header={<TG.Modal.Header after={<TG.Modal.Close><Icon28Close style={{color: 'var(--tgui--plain_foreground)'}} /></TG.Modal.Close>}>Only iOS header</TG.Modal.Header>}
          trigger={<Button
              className="group/card relative h-full overflow-hidden rounded-2xl bg-gray-800 p-px before:pointer-events-none before:absolute before:-left-40 before:-top-40 before:z-10 before:h-80 before:w-80 before:translate-x-[var(--mouse-x)] before:translate-y-[var(--mouse-y)] before:rounded-full before:bg-indigo-500/80 before:opacity-0 before:blur-3xl before:transition-opacity before:duration-500 after:pointer-events-none after:absolute after:-left-48 after:-top-48 after:z-30 after:h-64 after:w-64 after:translate-x-[var(--mouse-x)] after:translate-y-[var(--mouse-y)] after:rounded-full after:bg-indigo-500 after:opacity-0 after:blur-3xl after:transition-opacity after:duration-500 hover:after:opacity-20 group-hover:before:opacity-100"
              type="button"
          >
            <div className="relative z-20 h-full overflow-hidden rounded-[inherit] bg-gray-950 after:absolute after:inset-0 after:bg-linear-to-br after:from-gray-900/50 after:via-gray-800/25 after:to-gray-900/50">
              {/* Arrow */}
              <div
                  className="absolute right-6 top-6 flex h-8 w-8 items-center justify-center rounded-full border border-gray-700/50 bg-gray-800/65 text-gray-200 opacity-0 transition-opacity group-hover/card:opacity-100"
                  aria-hidden="true"
              >
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width={9}
                    height={8}
                    fill="none"
                >
                  <path
                      fill="#F4F4F5"
                      d="m4.92 8-.787-.763 2.733-2.68H0V3.443h6.866L4.133.767 4.92 0 9 4 4.92 8Z"
                  />
                </svg>
              </div>
              {/* Image */}
              <img
                  className="inline-flex"
                  src={`/public/images/${testimonial.client_img_filename}`}
                  width={350}
                  height={288}
                  alt="/public/images/logo.svg"
              />
              {/* Content */}
              <div className="p-6">
                <div className="mb-3">
                        <span className="btn-sm relative rounded-full bg-gray-800/40 px-2.5 py-0.5 text-xs font-normal before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:border before:border-transparent before:[background:linear-gradient(to_bottom,--theme(--color-gray-700/.15),--theme(--color-gray-700/.5))_border-box] before:[mask-composite:exclude_!important] before:[mask:linear-gradient(white_0_0)_padding-box,_linear-gradient(white_0_0)] hover:bg-gray-800/60">
                          <span className="bg-linear-to-r from-indigo-500 to-indigo-200 bg-clip-text text-transparent">
                            {testimonial.name}
                          </span>
                        </span>
                </div>
                <p className="text-indigo-200/65 before:content-[' '] after:content-[' ']">
                  {children}
                </p>
              </div>
            </div>
          </Button>}
      >
        <div className="container-gradient">
          <img
              alt="Telegram sticker"
              src="https://xelene.me/telegram.gif"
              style={{
                 display: 'block',
                height: '144px',
                width: '144px'
              }}
          />
          <div
              onPointerDownCapture={(e) => e.stopPropagation()}
              onTouchStartCapture={(e) => e.stopPropagation()}
              onTouchMoveCapture={(e) => e.stopPropagation()}
              data-vaul-no-drag
              style={{ touchAction: 'none' }}
          >
            <ThemeProvider theme={theme}>
              <LocalizationProvider dateAdapter={AdapterDayjs} >
                <DateTimePicker
                    className="datatime-gray"
                    value={pickerDate}
                    onChange={(newVal) => setPickerDate(newVal)}
                    shouldDisableTime={shouldDisableTimeRange}
                    label="Выбор даты/времени"
                    ampm={false}
                    disablePast={true}
                    autoFocus={false}
                    slotProps={{
                      popper: {
                        disablePortal: true,
                        slotProps: {
                          root: {
                            onKeyDown: (e) => e.stopPropagation(),
                          }
                        },
                      },
                      dialog: {
                        disableEnforceFocus: true,
                        disableRestoreFocus: true,
                      }
                    }}
                />
              </LocalizationProvider>
            </ThemeProvider>
            <TG.Section
                header="Длительность"
                footer={`Выбрано: ${duration / 60} минут`}
            >
              <TG.Slider
                  step={1800}
                  min={1800}
                  max={7200}
                  value={duration}
                  onChange={(val) => setDuration(val)}
                  data-vaul-no-drag
              />
            </TG.Section>
            <div style={{ marginTop: '24px' }}>
              <TG.Button
                  mode="filled"
                  size="l"
                  loading={isLoading}
                  onClick={handleBook}
              >
                Забронировать
              </TG.Button>
            </div>
          </div>
        </div>
      </TG.Modal>
  );
}

