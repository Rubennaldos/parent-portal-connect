/**
 * SmartPersonSearch — buscador inteligente de personas.
 *
 * Usa pg_trgm vía search_persons_v2 RPC:
 *  - Tolerante a typos, insensible a tildes, búsqueda parcial
 *  - Debounce 300ms, caché en memoria 60s
 *  - Resultados ordenados por relevancia con score
 *  - Teclado: flechas ↑↓, Enter para seleccionar, Esc para cerrar
 *
 * Uso básico:
 *   <SmartPersonSearch
 *     schoolId={mySchoolId}
 *     types={['student', 'teacher']}
 *     onSelect={(person) => console.log(person)}
 *     placeholder="Buscar alumno o profesor..."
 *   />
 */

import { useRef, useEffect } from 'react';
import { Loader2, User, GraduationCap, ShieldCheck, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { usePersonSearch, PersonResult } from '@/hooks/usePersonSearch';

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface SmartPersonSearchProps {
  /** Filtrar por sede */
  schoolId?:      string | null;
  /** Tipos de entidad a incluir */
  types?:         Array<'student' | 'teacher' | 'admin'>;
  /** Máx resultados por tipo */
  limit?:         number;
  /** Callback al seleccionar un resultado */
  onSelect?:      (person: PersonResult) => void;
  /** Placeholder del input */
  placeholder?:   string;
  /** Clase extra para el contenedor */
  className?:     string;
  /** Deshabilitar */
  disabled?:      boolean;
  /** Valor del input controlado externamente */
  value?:         string;
  /** Input no controlado: tamaño */
  size?:          'sm' | 'md' | 'lg';
}

// ── Helpers visuales ──────────────────────────────────────────────────────────

const TYPE_CONFIG = {
  student: {
    label: 'Alumnos',
    icon:  GraduationCap,
    badge: 'bg-blue-100 text-blue-700',
    dot:   'bg-blue-500',
  },
  teacher: {
    label: 'Profesores',
    icon:  User,
    badge: 'bg-green-100 text-green-700',
    dot:   'bg-green-500',
  },
  admin: {
    label: 'Administradores',
    icon:  ShieldCheck,
    badge: 'bg-purple-100 text-purple-700',
    dot:   'bg-purple-500',
  },
} as const;

/** Resalta en negrita las letras que coinciden con la query */
function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query.trim() || !text) return <span>{text}</span>;

  const normalize = (s: string) =>
    s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  const normText  = normalize(text);
  const normQuery = normalize(query.trim());

  const idx = normText.indexOf(normQuery);
  if (idx === -1) return <span>{text}</span>;

  return (
    <span>
      {text.slice(0, idx)}
      <mark className="bg-amber-100 text-amber-900 rounded px-0.5 font-bold not-italic">
        {text.slice(idx, idx + query.trim().length)}
      </mark>
      {text.slice(idx + query.trim().length)}
    </span>
  );
}

/** Foto o avatar con inicial */
function PersonAvatar({ person }: { person: PersonResult }) {
  const cfg = TYPE_CONFIG[person.entity_type];
  const initial = person.full_name?.[0]?.toUpperCase() ?? '?';

  if (person.photo_url) {
    return (
      <img
        src={person.photo_url}
        alt={person.full_name}
        className="w-8 h-8 rounded-full object-cover flex-shrink-0"
      />
    );
  }

  return (
    <div className={cn(
      'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold text-white',
      person.entity_type === 'student' ? 'bg-blue-500'   :
      person.entity_type === 'teacher' ? 'bg-green-500'  : 'bg-purple-500'
    )}>
      {initial}
    </div>
  );
}

// ── Componente principal ───────────────────────────────────────────────────────

export function SmartPersonSearch({
  schoolId    = null,
  types       = ['student', 'teacher'],
  limit       = 10,
  onSelect,
  placeholder = 'Buscar por nombre...',
  className,
  disabled    = false,
  size        = 'md',
}: SmartPersonSearchProps) {
  const { query, setQuery, results, loading, error, clear } =
    usePersonSearch({ schoolId, types, limit });

  const inputRef = useRef<HTMLInputElement>(null);
  const isOpen   = query.trim().length >= 2;

  // Agrupar resultados por tipo
  const grouped = types.reduce<Record<string, PersonResult[]>>(
    (acc, type) => {
      acc[type] = results.filter(r => r.entity_type === type);
      return acc;
    },
    {} as Record<string, PersonResult[]>
  );
  const hasResults = results.length > 0;

  function handleSelect(person: PersonResult) {
    onSelect?.(person);
    clear();
    inputRef.current?.blur();
  }

  // Cerrar con Esc
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) { clear(); inputRef.current?.blur(); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, clear]);

  const inputHeight = size === 'sm' ? 'h-8 text-xs' : size === 'lg' ? 'h-12 text-base' : 'h-10 text-sm';

  return (
    <div className={cn('relative w-full', className)}>
      <Command
        className="rounded-xl border shadow-sm bg-white overflow-visible"
        shouldFilter={false}
      >
        {/* Input — CommandInput ya incluye ícono de lupa propio */}
        <div className="relative">
          <CommandInput
            ref={inputRef}
            value={query}
            onValueChange={setQuery}
            placeholder={disabled ? 'Búsqueda deshabilitada' : placeholder}
            disabled={disabled}
            className={cn(
              inputHeight,
              disabled && 'cursor-not-allowed opacity-50'
            )}
          />
          {/* Spinner de carga (se solapa sobre el ícono de lupa) */}
          {loading && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
              <Loader2 className="h-4 w-4 text-orange-500 animate-spin" />
            </div>
          )}
          {/* Botón limpiar */}
          {query && (
            <button
              onClick={clear}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
              tabIndex={-1}
              title="Limpiar búsqueda"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Resultados */}
        {isOpen && (
          <CommandList className="border-t max-h-80 overflow-y-auto">
            {/* Estado: buscando */}
            {loading && !hasResults && (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-gray-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                Buscando...
              </div>
            )}

            {/* Estado: error */}
            {error && (
              <div className="px-4 py-3 text-sm text-red-600 bg-red-50">
                {error}
              </div>
            )}

            {/* Estado: sin resultados */}
            {!loading && !error && !hasResults && (
              <CommandEmpty className="py-6 text-center text-sm text-gray-400">
                No se encontraron resultados para
                <span className="font-semibold text-gray-700"> "{query}"</span>
                <p className="text-xs text-gray-400 mt-1">
                  Prueba con otra parte del nombre
                </p>
              </CommandEmpty>
            )}

            {/* Resultados agrupados por tipo */}
            {!loading && hasResults &&
              types.map(type => {
                const group = grouped[type];
                if (!group?.length) return null;
                const cfg = TYPE_CONFIG[type];
                const Icon = cfg.icon;

                return (
                  <CommandGroup
                    key={type}
                    heading={
                      <div className="flex items-center gap-1.5 px-1">
                        <Icon className="h-3.5 w-3.5" />
                        <span>{cfg.label}</span>
                        <span className={cn('ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold', cfg.badge)}>
                          {group.length}
                        </span>
                      </div>
                    }
                  >
                    {group.map(person => (
                      <CommandItem
                        key={`${person.entity_type}-${person.id}`}
                        value={`${person.entity_type}-${person.id}`}
                        onSelect={() => handleSelect(person)}
                        className="flex items-center gap-3 px-3 py-2 cursor-pointer rounded-lg aria-selected:bg-orange-50"
                      >
                        <PersonAvatar person={person} />

                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 truncate">
                            <HighlightMatch text={person.full_name} query={query} />
                          </p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            {person.subtitle && (
                              <span className="text-xs text-gray-500 truncate">
                                {person.subtitle}
                              </span>
                            )}
                            {person.school_name && (
                              <>
                                {person.subtitle && <span className="text-gray-300">·</span>}
                                <span className="text-xs text-gray-400 truncate">
                                  {person.school_name}
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Score de relevancia (debug: solo en dev) */}
                        {import.meta.env.DEV && (
                          <span className="text-[9px] text-gray-300 flex-shrink-0">
                            {Math.round(person.score * 100)}%
                          </span>
                        )}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                );
              })
            }

            {/* Footer */}
            {hasResults && (
              <div className="border-t px-3 py-1.5 text-[10px] text-gray-400 flex items-center gap-1">
                <kbd className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[9px]">↑↓</kbd>
                navegar
                <kbd className="ml-1 rounded bg-gray-100 px-1 py-0.5 font-mono text-[9px]">Enter</kbd>
                seleccionar
                <kbd className="ml-1 rounded bg-gray-100 px-1 py-0.5 font-mono text-[9px]">Esc</kbd>
                cerrar
              </div>
            )}
          </CommandList>
        )}
      </Command>
    </div>
  );
}

// ── Versión modal (popup sobre cualquier botón) ───────────────────────────────

export interface SmartPersonSearchModalProps extends SmartPersonSearchProps {
  trigger: React.ReactNode;
}

export function SmartPersonSearchModal({ trigger, ...props }: SmartPersonSearchModalProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-[380px] p-0" align="start" sideOffset={4}>
        <SmartPersonSearch {...props} />
      </PopoverContent>
    </Popover>
  );
}
