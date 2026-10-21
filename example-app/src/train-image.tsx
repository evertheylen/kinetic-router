const scenes = new Set(['home', 'account', 'agencies', 'NMBS', 'DB', 'OBB']);

export function TrainImage(props: { page: string }) {
  const src = () => `/assets/trains/${scenes.has(props.page) ? props.page : 'agencies'}.jpg`;

  return (
    <figure class="train-image">
      <img
        src={src()}
        alt={`Original train illustration for ${props.page}`}
        width={960}
        height={540}
        loading="eager"
      />
      <figcaption><code>{src()}</code> — original CC0 illustration</figcaption>
    </figure>
  );
}
